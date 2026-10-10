import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validateDefinition } from "@/lib/workflows/validate-definition.cjs";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function POST(request: NextRequest, context: { params: Promise<{ workflowId: string }> }) {
  try {
    const { workflowId } = await context.params;
    if (!uuidPattern.test(workflowId)) return NextResponse.json({ error: "Invalid workflow ID." }, { status: 400 });

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

    const { data: workflow, error: workflowError } = await supabase.from("workflows")
      .select("id").eq("id", workflowId).maybeSingle();
    if (workflowError) throw workflowError;
    if (!workflow) return NextResponse.json({ error: "Workflow not found or you do not have access to it." }, { status: 404 });

    let body: unknown;
    try { body = await request.json(); } catch {
      return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
    }
    if (!body || typeof body !== "object" || !("definition" in body)) {
      return NextResponse.json({ error: "A workflow definition is required." }, { status: 400 });
    }

    const validated = validateDefinition(body.definition);
    if (!validated.definition) return NextResponse.json({ valid: false, error: validated.error }, { status: 422 });

    const nodes = validated.definition.nodes;
    return NextResponse.json({
      valid: true,
      counts: {
        triggers: nodes.filter((node) => node.type === "trigger").length,
        actions: nodes.filter((node) => node.type === "action").length,
        conditions: nodes.filter((node) => node.type === "condition").length,
      },
      checks: ["definition schema", "step IDs and types", "trigger placement", "step limits", "step configuration"],
      executed: false,
      saved: false,
    });
  } catch (error) {
    console.error("Failed to validate Aivanta workflow draft:", error);
    return NextResponse.json({ error: "Could not validate this draft. Try again." }, { status: 500 });
  }
}

export async function GET(_request: NextRequest, context: { params: Promise<{ workflowId: string }> }) {
  try {
    const { workflowId } = await context.params;
    if (!uuidPattern.test(workflowId)) return NextResponse.json({ error: "Invalid workflow ID." }, { status: 400 });

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

    const { data, error } = await supabase.from("workflows")
      .select("id, name, description, status, definition")
      .eq("id", workflowId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Workflow not found or you do not have access to it." }, { status: 404 });

    const stored = data.definition as { version?: unknown; nodes?: unknown } | null;
    const valid = validateDefinition(stored && typeof stored === "object" ? stored : { version: 1, nodes: [] });
    return NextResponse.json({
      workflow: { id: data.id, name: data.name, description: data.description, status: data.status },
      definition: valid.definition ?? { version: 1, nodes: [] },
    });
  } catch (error) {
    console.error("Failed to load Aivanta workflow definition:", error);
    return NextResponse.json({ error: "Could not load this workflow. Try again." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ workflowId: string }> }) {
  try {
    const { workflowId } = await context.params;
    if (!uuidPattern.test(workflowId)) return NextResponse.json({ error: "Invalid workflow ID." }, { status: 400 });

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

    let body: unknown;
    try { body = await request.json(); } catch {
      return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
    }
    if (!body || typeof body !== "object" || !("definition" in body)) {
      return NextResponse.json({ error: "A workflow definition is required." }, { status: 400 });
    }
    const validated = validateDefinition(body.definition);
    if (!validated.definition) return NextResponse.json({ error: validated.error }, { status: 400 });

    const { data, error } = await supabase.rpc("save_workflow_definition", {
      p_workflow_id: workflowId,
      p_definition: validated.definition,
    });
    if (error) {
      if (error.code === "P0002") {
        return NextResponse.json({ error: "Workflow not found or you do not have access to it." }, { status: 404 });
      }
      throw error;
    }
    const saved = Array.isArray(data) ? data[0] : data;
    if (!saved) return NextResponse.json({ error: "Workflow not found or you do not have access to it." }, { status: 404 });
    return NextResponse.json({ success: true, version: saved.saved_version, definition: validated.definition });
  } catch (error) {
    console.error("Failed to save Aivanta workflow definition:", error);
    return NextResponse.json({ error: "Could not save workflow steps. Try again." }, { status: 500 });
  }
}
