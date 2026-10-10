import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

const allowedStatuses = new Set(["draft", "active", "paused", "archived"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function formatUpdatedAt(value: string): string {
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (elapsedSeconds < 60) return "Just now";
  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(value).toLocaleDateString();
}

function presentWorkflow(row: {
  id: string;
  name: string;
  description: string;
  status: string;
  updated_at: string;
}) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: "Uncategorized",
    status: row.status.charAt(0).toUpperCase() + row.status.slice(1),
    runs: "—",
    updated: formatUpdatedAt(row.updated_at),
    icon: "✳",
    tone: "lime",
  };
}

async function getAuthenticatedClient() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { response: NextResponse.json({ error: "Authentication required." }, { status: 401 }) };
  return { supabase, user };
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ workflowId: string }> }) {
  try {
    const { workflowId } = await context.params;
    if (!uuidPattern.test(workflowId)) {
      return NextResponse.json({ error: "Invalid workflow ID." }, { status: 400 });
    }

    const auth = await getAuthenticatedClient();
    if ("response" in auth) return auth.response;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
    }

    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "A workflow update is required." }, { status: 400 });
    }

    const updates: { name?: string; description?: string; status?: string } = {};
    if ("name" in body) {
      if (typeof body.name !== "string" || body.name.trim().length < 1 || body.name.trim().length > 80) {
        return NextResponse.json({ error: "Workflow names must be between 1 and 80 characters." }, { status: 400 });
      }
      updates.name = body.name.trim();
    }
    if ("description" in body) {
      if (typeof body.description !== "string" || body.description.trim().length > 500) {
        return NextResponse.json({ error: "Descriptions cannot exceed 500 characters." }, { status: 400 });
      }
      updates.description = body.description.trim();
    }
    if ("status" in body) {
      if (typeof body.status !== "string" || !allowedStatuses.has(body.status)) {
        return NextResponse.json({ error: "Choose a valid workflow status." }, { status: 400 });
      }
      updates.status = body.status;
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Provide a name, description, or status to update." }, { status: 400 });
    }

    const { data, error } = await auth.supabase
      .from("workflows")
      .update(updates)
      .eq("id", workflowId)
      .select("id, name, description, status, updated_at")
      .maybeSingle();

    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Workflow not found or you do not have access to it." }, { status: 404 });
    return NextResponse.json({ workflow: presentWorkflow(data) });
  } catch (error) {
    console.error("Failed to update Aivanta workflow:", error);
    return NextResponse.json({ error: "Could not update this workflow. Try again." }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ workflowId: string }> }) {
  try {
    const { workflowId } = await context.params;
    if (!uuidPattern.test(workflowId)) {
      return NextResponse.json({ error: "Invalid workflow ID." }, { status: 400 });
    }

    const auth = await getAuthenticatedClient();
    if ("response" in auth) return auth.response;

    const { data, error } = await auth.supabase
      .from("workflows")
      .delete()
      .eq("id", workflowId)
      .select("id")
      .maybeSingle();

    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Workflow not found or you do not have access to it." }, { status: 404 });
    return NextResponse.json({ success: true, id: data.id });
  } catch (error) {
    console.error("Failed to delete Aivanta workflow:", error);
    return NextResponse.json({ error: "Could not delete this workflow. Try again." }, { status: 500 });
  }
}
