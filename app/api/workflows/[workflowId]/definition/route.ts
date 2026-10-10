import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const nodeTypes = new Set(["trigger", "action", "condition"]);
const idPattern = /^[a-zA-Z0-9_-]{1,64}$/;
const maxNodes = 30;

type WorkflowNode = {
  id: string;
  type: "trigger" | "action" | "condition";
  title: string;
  description: string;
};

function validateDefinition(value: unknown): { definition?: { version: 1; nodes: WorkflowNode[] }; error?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "Workflow definition must be an object." };
  const input = value as Record<string, unknown>;
  if (input.version !== 1 || !Array.isArray(input.nodes)) return { error: "Use workflow definition version 1 with a nodes array." };
  if (input.nodes.length > maxNodes) return { error: `A workflow can contain at most ${maxNodes} steps.` };

  const ids = new Set<string>();
  const nodes: WorkflowNode[] = [];
  for (const candidate of input.nodes) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return { error: "Each workflow step must be an object." };
    const node = candidate as Record<string, unknown>;
    if (typeof node.id !== "string" || !idPattern.test(node.id) || ids.has(node.id)) return { error: "Each step needs a unique, valid ID." };
    if (typeof node.type !== "string" || !nodeTypes.has(node.type)) return { error: "Each step must be a trigger, action, or condition." };
    if (typeof node.title !== "string" || node.title.trim().length < 1 || node.title.trim().length > 80) return { error: "Step titles must be between 1 and 80 characters." };
    if (typeof node.description !== "string" || node.description.trim().length > 240) return { error: "Step descriptions cannot exceed 240 characters." };
    ids.add(node.id);
    nodes.push({ id: node.id, type: node.type as WorkflowNode["type"], title: node.title.trim(), description: node.description.trim() });
  }
  if (nodes.length > 0 && nodes[0].type !== "trigger") return { error: "The first step must be a trigger." };
  if (nodes.filter((node) => node.type === "trigger").length > 1) return { error: "A workflow can only have one trigger." };
  return { definition: { version: 1, nodes } };
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
