import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validateDefinition } from "@/lib/workflows/validate-definition.cjs";
import { findOperation } from "@/nodes/registry";
import type { RegisteredWorkflowStep } from "@/nodes/workflow-runner";

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
    const starterDefinition = {
      version: 1 as const,
      nodes: [{
        id: "trigger-1",
        type: "trigger" as const,
        title: "When this happens",
        description: "Choose an event that starts your workflow.",
        settings: { event: "manual" },
      }],
    };
    return NextResponse.json({
      workflow: { id: data.id, name: data.name, description: data.description, status: data.status },
      definition: valid.definition ?? starterDefinition,
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

    // Keep the existing version-1 nodes contract for the builder and database RPC,
    // while optionally storing a registry execution plan alongside it. The RPC
    // validates the legacy nodes and persists the full JSON document atomically.
    let definitionToSave: Record<string, unknown> = validated.definition;
    if ("registrySteps" in body) {
      if (!Array.isArray(body.registrySteps) || body.registrySteps.length < 1 || body.registrySteps.length > 30) {
        return NextResponse.json({ error: "Registry workflows require between 1 and 30 steps." }, { status: 400 });
      }
      const registrySteps = body.registrySteps as unknown[];
      const seen = new Set<string>();
      for (const candidate of registrySteps) {
        if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
          return NextResponse.json({ error: "Each registry step must be an object." }, { status: 400 });
        }
        const step = candidate as Record<string, unknown>;
        if (typeof step.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(step.id) || seen.has(step.id) ||
            typeof step.nodeId !== "string" || typeof step.operationId !== "string" ||
            (step.kind !== "trigger" && step.kind !== "action") || !("input" in step)) {
          return NextResponse.json({ error: "Registry steps must have unique IDs, a registered operation, a kind, and input." }, { status: 400 });
        }
        seen.add(step.id);
        const operation = findOperation(step.nodeId, step.operationId, step.kind);
        if (!operation) return NextResponse.json({ error: `Unknown registry operation: ${step.nodeId}.${step.operationId}.` }, { status: 422 });
        const parsedInput = operation.inputSchema.safeParse(step.input);
        if (!parsedInput.success) return NextResponse.json({ error: `Invalid input for registry step ${step.id}.` }, { status: 422 });
      }
      if (registrySteps[0] && (registrySteps[0] as Record<string, unknown>).kind !== "trigger") {
        return NextResponse.json({ error: "The first registry step must be a trigger." }, { status: 400 });
      }
      if (registrySteps.filter((step) => (step as Record<string, unknown>).kind === "trigger").length !== 1) {
        return NextResponse.json({ error: "A registry workflow must contain exactly one trigger." }, { status: 400 });
      }
      definitionToSave = {
        ...validated.definition,
        format: "aivanta-registry-v1",
        steps: registrySteps as RegisteredWorkflowStep[],
      };
    }

    const { data, error } = await supabase.rpc("save_workflow_definition", {
      p_workflow_id: workflowId,
      p_definition: definitionToSave,
    });
    if (error) {
      if (error.code === "P0002") {
        return NextResponse.json({ error: "Workflow not found or you do not have access to it." }, { status: 404 });
      }
      throw error;
    }
    const saved = Array.isArray(data) ? data[0] : data;
    if (!saved) return NextResponse.json({ error: "Workflow not found or you do not have access to it." }, { status: 404 });
    return NextResponse.json({ success: true, version: saved.saved_version, definition: validated.definition, registry: "registrySteps" in body ? { format: "aivanta-registry-v1", steps: body.registrySteps } : null });
  } catch (error) {
    console.error("Failed to save Aivanta workflow definition:", error);
    return NextResponse.json({ error: "Could not save workflow steps. Try again." }, { status: 500 });
  }
}
