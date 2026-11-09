import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
import { validateDefinition } from "@/lib/workflows/validate-definition.cjs";
import { findOperation } from "@/nodes/registry";
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

    let definitionToSave: Record<string, unknown> = definitionResult.definition;
    if ("registrySteps" in body) {
      if (!Array.isArray(body.registrySteps) || body.registrySteps.length < 1 || body.registrySteps.length > 30) return NextResponse.json({ error: "Registry workflows require between 1 and 30 steps." }, { status: 400 });
      const steps = body.registrySteps as unknown[];
      const ids = new Set<string>();
      for (const item of steps) {
        if (!item || typeof item !== "object" || Array.isArray(item)) return NextResponse.json({ error: "Each registry step must be an object." }, { status: 400 });
        const step = item as Record<string, unknown>;
        if (typeof step.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(step.id) || ids.has(step.id) || typeof step.nodeId !== "string" || typeof step.operationId !== "string" || (step.kind !== "trigger" && step.kind !== "action") || !("input" in step)) return NextResponse.json({ error: "Registry steps must have unique IDs, registered operations, kind, and input." }, { status: 400 });
        ids.add(step.id);
        const operation = findOperation(step.nodeId, step.operationId, step.kind);
        if (!operation || !operation.inputSchema.safeParse(step.input).success) return NextResponse.json({ error: "A registry step contains an unknown operation or invalid input." }, { status: 422 });
      }
      if ((steps[0] as Record<string, unknown>).kind !== "trigger" || steps.filter(item => (item as Record<string, unknown>).kind === "trigger").length !== 1) return NextResponse.json({ error: "A registry workflow must contain exactly one trigger first." }, { status: 400 });
      definitionToSave = { ...definitionResult.definition, format: "aivanta-registry-v1", steps: steps as RegisteredWorkflowStep[] };
    }

    const workspace = await getOrCreateDefaultWorkspace(supabase);
    const { data, error } = await supabase
      .from("workflows")
      .insert({
        workspace_id: workspace.id,
        name,
        description,
        status,
        definition: definitionToSave,
        created_by: user.id,
      })
      .select("id, name, description, status, updated_at")
      .single();

    if (error?.code === "P0001" && error.message === "AIVANTA_WORKFLOW_LIMIT_REACHED") {
      return NextResponse.json({ error: "Workspace active-workflow limit reached. Upgrade your plan to activate more workflows." }, { status: 402, headers: { "Cache-Control": "private, no-store" } });
    }
    if (error?.code === "P0001" && error.message === "AIVANTA_ENTERPRISE_LIMITS_NOT_CONFIGURED") {
      return NextResponse.json({ error: "Enterprise workflow limits must be configured before activating workflows." }, { status: 409, headers: { "Cache-Control": "private, no-store" } });
    }
    if (error?.code === "P0001" && error.message === "AIVANTA_SUBSCRIPTION_INACTIVE") {
      return NextResponse.json({ error: "This workspace subscription is inactive. Update billing before activating workflows." }, { status: 402, headers: { "Cache-Control": "private, no-store" } });
    }
    if (error) throw error;
    return NextResponse.json(
      { workflow: presentWorkflow(data) },
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
