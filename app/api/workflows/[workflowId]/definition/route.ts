import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validateDefinition } from "@/lib/workflows/validate-definition.cjs";
import { validateRegisteredSteps } from "@/nodes/validate-steps";
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

    const stored = data.definition as Record<string, unknown> | null;
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
    // The shared v1 validator intentionally returns only its normalized legacy
    // nodes. Preserve the registry execution plan separately so a saved graph
    // can round-trip through GET without silently degrading to legacy nodes.
    let registryPlan: Record<string, unknown> = {};
    if (stored?.format === "aivanta-registry-v1") {
      const checkedRegistry = validateRegisteredSteps(stored.steps);
      if (!checkedRegistry.steps) {
        return NextResponse.json({ error: "This saved registry workflow needs repair before it can be edited.", detail: checkedRegistry.error }, { status: 409 });
      }
      registryPlan = { format: "aivanta-registry-v1", steps: checkedRegistry.steps };
    }
    return NextResponse.json({
      workflow: { id: data.id, name: data.name, description: data.description, status: data.status },
      definition: { ...(valid.definition ?? starterDefinition), nodes: (valid.definition ?? starterDefinition).nodes.map((node, index) => { const savedNode = Array.isArray(stored?.nodes) ? stored.nodes[index] as Record<string, unknown> | undefined : undefined; const step = Array.isArray(stored?.steps) ? (stored.steps as Record<string, unknown>[]).find((item) => item.id === node.id) : undefined; return { ...node, ...(savedNode?.position ? { position: savedNode.position } : {}), ...(step ? { registryNodeId: step.nodeId, registryOperationId: step.operationId, registryInput: step.input, settings: { ...node.settings, provider: step.nodeId, operation: step.operationId } } : {}) }; }), ...(stored && Array.isArray(stored.edges) ? { edges: stored.edges } : {}), ...(stored && Array.isArray(stored.nodes) ? { nodes: (valid.definition ?? starterDefinition).nodes.map((node, index) => ({ ...node, ...(typeof stored.nodes[index] === "object" && stored.nodes[index] ? { position: (stored.nodes[index] as Record<string, unknown>).position } : {}) })) : {}, ...registryPlan },
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
    const requestBody = body as Record<string, unknown>;
    const validated = validateDefinition(requestBody.definition);
    if (!validated.definition) return NextResponse.json({ error: validated.error }, { status: 400 });

    // Keep the existing version-1 nodes contract for the builder and database RPC,
    // while optionally storing a registry execution plan alongside it. The RPC
    // validates the legacy nodes and persists the full JSON document atomically.
    let definitionToSave: Record<string, unknown> = { ...validated.definition, ...(requestBody.definition && typeof requestBody.definition === "object" ? { edges: (requestBody.definition as Record<string, unknown>).edges, nodes: validated.definition.nodes.map((node, index) => ({ ...node, position: ((requestBody.definition as Record<string, unknown>).nodes as Record<string, unknown>[] | undefined)?.[index]?.position })) : {} };
    const legacyNodes = validated.definition.nodes;
    const canBridgeLegacyDefinition = legacyNodes[0]?.type === "trigger" &&
      legacyNodes[0].settings.event === "manual" &&
      legacyNodes.slice(1).every((node) => node.type === "action" &&
        ((node.settings.provider === "email" && node.settings.operation === "send_email") ||
         (node.settings.provider === "slack" && node.settings.operation === "send_message")));
    const autoRegistrySteps: RegisteredWorkflowStep[] | null = canBridgeLegacyDefinition
      ? legacyNodes.map((node) => {
          if (node.type === "trigger") {
            return { id: node.id, nodeId: "manual", operationId: "start", kind: "trigger", input: {} };
          }
          const provider = node.settings.provider ?? "internal";
          if (provider === "email") {
            return { id: node.id, nodeId: "email", operationId: "send_email", kind: "action", input: {
              to: node.settings.recipient ?? "",
              subject: (node.title || "Aivanta workflow notification").slice(0, 200),
              text: node.settings.message?.trim() || node.title,
            } };
          }
          return { id: node.id, nodeId: "slack", operationId: "send_message", kind: "action", input: {
            message: node.settings.message?.trim() || node.title,
          } };
        })
      : null;
    const hasExplicitRegistrySteps = Object.prototype.hasOwnProperty.call(requestBody, "registrySteps");
    const registryStepsInput = hasExplicitRegistrySteps ? requestBody.registrySteps : autoRegistrySteps;
    const shouldSaveRegistry = hasExplicitRegistrySteps || autoRegistrySteps !== null;
    if (shouldSaveRegistry) {
      const validatedRegistry = validateRegisteredSteps(registryStepsInput);
      if (!validatedRegistry.steps) {
        return NextResponse.json({ error: validatedRegistry.error || "Invalid registry workflow." }, { status: 422 });
      }
      definitionToSave = {
        ...validated.definition,
        format: "aivanta-registry-v1",
        steps: validatedRegistry.steps,
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
    return NextResponse.json({ success: true, version: saved.saved_version, definition: validated.definition, registry: shouldSaveRegistry ? { format: "aivanta-registry-v1", steps: registryStepsInput } : null });
  } catch (error) {
    console.error("Failed to save Aivanta workflow definition:", error);
    return NextResponse.json({ error: "Could not save workflow steps. Try again." }, { status: 500 });
  }
}
