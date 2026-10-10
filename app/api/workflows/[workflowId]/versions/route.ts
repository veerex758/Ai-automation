import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(_request: NextRequest, context: { params: Promise<{ workflowId: string }> }) {
  try {
    const { workflowId } = await context.params;
    if (!uuidPattern.test(workflowId)) {
      return NextResponse.json({ error: "Invalid workflow ID." }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const { data: workflow, error: workflowError } = await supabase
      .from("workflows")
      .select("id")
      .eq("id", workflowId)
      .maybeSingle();
    if (workflowError) throw workflowError;
    if (!workflow) {
      return NextResponse.json({ error: "Workflow not found or you do not have access to it." }, { status: 404 });
    }

    const { data, error } = await supabase
      .from("workflow_versions")
      .select("version, created_at")
      .eq("workflow_id", workflowId)
      .order("version", { ascending: false })
      .limit(10);
    if (error) throw error;

    return NextResponse.json({ versions: data ?? [] });
  } catch (error) {
    console.error("Failed to load Aivanta workflow versions:", error);
    return NextResponse.json({ error: "Could not load version history. Try again." }, { status: 500 });
  }
}


export async function POST(request: NextRequest, context: { params: Promise<{ workflowId: string }> }) {
  try {
    const { workflowId } = await context.params;
    if (!uuidPattern.test(workflowId)) {
      return NextResponse.json({ error: "Invalid workflow ID." }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    let body: unknown;
    try { body = await request.json(); } catch {
      return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
    }
    if (!body || typeof body !== "object" || !("version" in body)) {
      return NextResponse.json({ error: "A version number is required." }, { status: 400 });
    }
    const version = (body as { version?: unknown }).version;
    if (!Number.isSafeInteger(version) || (version as number) < 1) {
      return NextResponse.json({ error: "Version must be a positive integer." }, { status: 400 });
    }

    const { data: snapshot, error: snapshotError } = await supabase
      .from("workflow_versions")
      .select("definition")
      .eq("workflow_id", workflowId)
      .eq("version", version as number)
      .maybeSingle();
    if (snapshotError) throw snapshotError;
    if (!snapshot) {
      return NextResponse.json({ error: "Version not found or you do not have access to it." }, { status: 404 });
    }

    const { data, error } = await supabase.rpc("save_workflow_definition", {
      p_workflow_id: workflowId,
      p_definition: snapshot.definition,
    });
    if (error) {
      if (error.code === "P0002") {
        return NextResponse.json({ error: "Workflow not found or you do not have access to it." }, { status: 404 });
      }
      if (error.code === "22023") {
        return NextResponse.json({ error: "This saved version is no longer valid and cannot be restored." }, { status: 422 });
      }
      throw error;
    }
    const saved = Array.isArray(data) ? data[0] : data;
    if (!saved) {
      return NextResponse.json({ error: "Workflow not found or you do not have access to it." }, { status: 404 });
    }

    return NextResponse.json({ success: true, restored_from: version, version: saved.saved_version });
  } catch (error) {
    console.error("Failed to restore Aivanta workflow version:", error);
    return NextResponse.json({ error: "Could not restore this version. Try again." }, { status: 500 });
  }
}
