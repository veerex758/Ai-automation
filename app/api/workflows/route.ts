import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
import { validateDefinition } from "@/lib/workflows/validate-definition.cjs";
import { buildRegistrySteps } from "@/lib/workflows/build-registry-steps";
import { validateRegisteredSteps } from "@/nodes/validate-steps";
import type { RegisteredWorkflowStep } from "@/nodes/workflow-runner";

const allowedStatuses = new Set(["draft", "active", "paused", "archived"]);

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

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401, headers: { "Cache-Control": "private, no-store" } },
      );
    }

    const workspace = await getOrCreateDefaultWorkspace(supabase);
    const { data, error } = await supabase
      .from("workflows")
      .select("id, name, description, status, updated_at")
      .eq("workspace_id", workspace.id)
      .order("updated_at", { ascending: false });

    if (error) throw error;
    return NextResponse.json({
      workspace,
      workflows: (data ?? []).map(presentWorkflow),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Failed to load Aivanta workflows:", error);
    return NextResponse.json(
      { error: "Could not load workflows. Check the Aivanta database configuration and try again." },
      { status: 500, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401, headers: { "Cache-Control": "private, no-store" } },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Request body must be valid JSON." },
        { status: 400, headers: { "Cache-Control": "private, no-store" } },
      );
    }

    if (!body || typeof body !== "object" || !("name" in body) || typeof body.name !== "string") {
      return NextResponse.json(
        { error: "A workflow name is required." },
        { status: 400, headers: { "Cache-Control": "private, no-store" } },
      );
    }

    const name = body.name.trim();
    if (name.length < 1 || name.length > 80) {
      return NextResponse.json(
        { error: "Workflow names must be between 1 and 80 characters." },
        { status: 400, headers: { "Cache-Control": "private, no-store" } },
      );
    }

    const description = "description" in body && typeof body.description === "string"
      ? body.description.trim()
      : "";
    if (description.length > 500) {
      return NextResponse.json(
        { error: "Workflow descriptions cannot exceed 500 characters." },
        { status: 400, headers: { "Cache-Control": "private, no-store" } },
      );
    }

    const status = "status" in body && typeof body.status === "string" && allowedStatuses.has(body.status)
      ? body.status
      : "draft";

    const definitionResult = "definition" in body
      ? validateDefinition(body.definition)
      : validateDefinition({
          version: 1,
          nodes: [{
            id: "trigger-1",
            type: "trigger",
            title: "When this happens",
            description: "Choose an event that starts your workflow.",
            settings: { event: "manual" },
          }],
        });
    if (!definitionResult.definition) {
      return NextResponse.json(
        { error: definitionResult.error || "Invalid workflow definition." },
        { status: 422, headers: { "Cache-Control": "private, no-store" } },
      );
    }

    const requestBody = body as Record<string, unknown>;
    const rawDefinition = requestBody.definition && typeof requestBody.definition === "object" && !Array.isArray(requestBody.definition)
      ? requestBody.definition as Record<string, unknown>
      : {};
    const rawNodes = Array.isArray(rawDefinition.nodes) ? rawDefinition.nodes as Array<Record<string, unknown>> : [];
    const definitionToSave: Record<string, unknown> = {
      ...definitionResult.definition,
      nodes: definitionResult.definition.nodes.map((node, index) => ({
        ...node,
        ...(rawNodes[index]?.position && typeof rawNodes[index].position === "object"
          ? { position: rawNodes[index].position }
          : {}),
      })),
      ...(Array.isArray(rawDefinition.edges) ? { edges: rawDefinition.edges } : {}),
    };

    if ("registrySteps" in body) {
      if (!Array.isArray(body.registrySteps) || body.registrySteps.length < 1 || body.registrySteps.length > 30) {
        return NextResponse.json({ error: "Registry workflows require between 1 and 30 steps." }, { status: 400 });
      }
      if (rawNodes.length !== definitionResult.definition.nodes.length || !Array.isArray(rawDefinition.edges)) {
        return NextResponse.json({ error: "Registry workflows must include every canvas node and its explicit connections." }, { status: 422 });
      }
      const suppliedSteps = body.registrySteps as unknown[];
      const registryById = new Map<string, Record<string, unknown>>();
      for (const item of suppliedSteps) {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          return NextResponse.json({ error: "Each registry step must be an object." }, { status: 400 });
        }
        const step = item as Record<string, unknown>;
        if (typeof step.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(step.id) || registryById.has(step.id) ||
            typeof step.nodeId !== "string" || typeof step.operationId !== "string" ||
            (step.kind !== "trigger" && step.kind !== "action") || !("input" in step)) {
          return NextResponse.json({ error: "Registry steps must have unique IDs, registered operations, kind, and input." }, { status: 400 });
        }
        registryById.set(step.id, step);
      }
      if (registryById.size !== rawNodes.length) {
        return NextResponse.json({ error: "Every canvas node must have exactly one registered execution step." }, { status: 422 });
      }
      const graphNodes = definitionToSave.nodes instanceof Array
        ? (definitionToSave.nodes as Array<Record<string, unknown>>).map((node) => {
            const step = registryById.get(String(node.id));
            if (!step) return node;
            return {
              ...node,
              registryNodeId: step.nodeId,
              registryOperationId: step.operationId,
              registryInput: step.input as Record<string, unknown>,
            };
          })
        : [];
      let rebuilt: RegisteredWorkflowStep[];
      try {
        rebuilt = buildRegistrySteps({
          nodes: graphNodes as Parameters<typeof buildRegistrySteps>[0]["nodes"],
          edges: rawDefinition.edges as Parameters<typeof buildRegistrySteps>[0]["edges"],
        });
      } catch (cause) {
        return NextResponse.json({ error: cause instanceof Error ? cause.message : "The workflow graph is invalid." }, { status: 422 });
      }
      const checked = validateRegisteredSteps(rebuilt);
      if (!checked.steps) {
        return NextResponse.json({ error: checked.error || "A registered operation failed validation." }, { status: 422 });
      }
      const mismatched = checked.steps.length !== suppliedSteps.length || checked.steps.some((step) => {
        const expected = registryById.get(step.id);
        return !expected || expected.nodeId !== step.nodeId || expected.operationId !== step.operationId ||
          expected.kind !== step.kind || JSON.stringify(expected.input) !== JSON.stringify(step.input);
      });
      if (mismatched) {
        return NextResponse.json({ error: "Canvas connections and registered execution steps do not match. Regenerate the draft before saving." }, { status: 422 });
      }
      Object.assign(definitionToSave, { format: "aivanta-registry-v1", steps: checked.steps });
    }

    const workspace = await getOrCreateDefaultWorkspace(supabase);
    // The database guard intentionally allows workflow creation only with an
    // empty definition. Persist the validated graph through the audited RPC so
    // version history and audit events are written atomically with the definition.
    const { data: createdWorkflow, error: createError } = await supabase
      .from("workflows")
      .insert({
        workspace_id: workspace.id,
        name,
        description,
        status,
        created_by: user.id,
      })
      .select("id, name, description, status, updated_at")
      .single();

    if (createError?.code === "P0001" && createError.message === "AIVANTA_WORKFLOW_LIMIT_REACHED") {
      return NextResponse.json({ error: "Workspace active-workflow limit reached. Upgrade your plan to activate more workflows." }, { status: 402, headers: { "Cache-Control": "private, no-store" } });
    }
    if (createError?.code === "P0001" && createError.message === "AIVANTA_ENTERPRISE_LIMITS_NOT_CONFIGURED") {
      return NextResponse.json({ error: "Enterprise workflow limits must be configured before activating workflows." }, { status: 409, headers: { "Cache-Control": "private, no-store" } });
    }
    if (createError?.code === "P0001" && createError.message === "AIVANTA_SUBSCRIPTION_INACTIVE") {
      return NextResponse.json({ error: "This workspace subscription is inactive. Update billing before activating workflows." }, { status: 402, headers: { "Cache-Control": "private, no-store" } });
    }
    if (createError) throw createError;

    const { data: savedRows, error: saveError } = await supabase.rpc("save_workflow_definition", {
      p_workflow_id: createdWorkflow.id,
      p_definition: definitionToSave,
    });
    if (saveError) {
      // Do not leave an empty orphan if the validated save fails. Scope cleanup
      // to the row just created by this authenticated user in this workspace.
      const { error: cleanupError } = await supabase
        .from("workflows")
        .delete()
        .eq("id", createdWorkflow.id)
        .eq("workspace_id", workspace.id)
        .eq("created_by", user.id);
      if (cleanupError) console.error("Failed to clean up an unsaved workflow draft:", cleanupError);
      if (saveError.code === "P0002") {
        return NextResponse.json({ error: "Workflow not found or you do not have access to it." }, { status: 404, headers: { "Cache-Control": "private, no-store" } });
      }
      throw saveError;
    }

    const saved = Array.isArray(savedRows) ? savedRows[0] : savedRows;
    if (!saved || saved.saved_workflow_id !== createdWorkflow.id) {
      throw new Error("The database did not confirm that the workflow definition was saved.");
    }

    return NextResponse.json(
      { workflow: presentWorkflow(createdWorkflow), version: saved.saved_version },
      { status: 201, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("Failed to create Aivanta workflow:", error);
    return NextResponse.json(
      { error: "Could not save this workflow. Check the Aivanta database configuration and try again." },
      { status: 500, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
