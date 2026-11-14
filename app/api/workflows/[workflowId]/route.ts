import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validateDefinition } from "@/lib/workflows/validate-definition.cjs";
import { validateRegisteredSteps } from "@/nodes/validate-steps";
import { buildRegistrySteps } from "@/lib/workflows/build-registry-steps";
import { validateDurableLiveSteps } from "@/lib/workflows/durable-worker";
import { getWorkerProvider } from "@/lib/workflows/worker-operation-map";
import type { RegisteredWorkflowStep } from "@/nodes/workflow-runner";

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

    if (updates.status === "active") {
      const { data: candidate, error: candidateError } = await auth.supabase
        .from("workflows").select("id,workspace_id,version,definition").eq("id", workflowId).maybeSingle();
      if (candidateError) throw candidateError;
      if (!candidate) return NextResponse.json({ error: "Workflow not found or you do not have access to it." }, { status: 404 });
      if (process.env.AIVANTA_LIVE_EXECUTION_ENABLED !== "true") {
        return NextResponse.json({ error: "Live execution is disabled by the server. The workflow was not activated." }, { status: 503 });
      }

      let steps: RegisteredWorkflowStep[];
      const stored = candidate.definition as Record<string, unknown> | null;
      if (stored?.format === "aivanta-registry-v1") {
        const checked = validateRegisteredSteps(stored.steps);
        if (!checked.steps) return NextResponse.json({ error: checked.error || "Workflow registry definition is invalid." }, { status: 422 });
        steps = checked.steps;
      } else {
        const checked = validateDefinition(candidate.definition);
        if (!checked.definition) return NextResponse.json({ error: checked.error || "Workflow definition is invalid." }, { status: 422 });
        try {
          steps = buildRegistrySteps({
            nodes: checked.definition.nodes,
            edges: Array.isArray(stored?.edges)
              ? stored.edges as Array<{ id: string; source: string; target: string; label: "true" | "false" | "next" }>
              : checked.definition.nodes.slice(1).map((node, index) => ({
                  id: "legacy-next-" + (index + 1),
                  source: checked.definition!.nodes[index].id,
                  target: node.id,
                  label: "next" as const,
                })),
          });
        } catch (cause) {
          return NextResponse.json({ error: cause instanceof Error ? cause.message : "Workflow graph is invalid." }, { status: 422 });
        }
      }

      const livePolicyError = validateDurableLiveSteps(steps);
      if (livePolicyError) {
        return NextResponse.json({ error: "This workflow is not approved for live execution.", code: livePolicyError }, { status: 403 });
      }

      const { data: tested, error: testError } = await auth.supabase.from("workflow_runs").select("id")
        .eq("workflow_id", workflowId).eq("workflow_version", candidate.version)
        .eq("mode", "dry_run").eq("status", "succeeded").limit(1);
      if (testError) throw testError;
      if (!tested?.length) {
        return NextResponse.json({ error: "Run a successful test of this exact saved workflow version before activating it." }, { status: 409 });
      }

      const providers = [...new Set(steps.map((step) => getWorkerProvider(step)).filter((provider): provider is string => Boolean(provider)))];
      const googleProducts: Record<string, string> = {
        gmail: "gmail", sheets: "sheets", google_drive: "drive", google_calendar: "calendar",
        google_docs: "docs", google_forms: "forms", youtube: "youtube", google_contacts: "contacts",
      };
      for (const provider of providers) {
        if (googleProducts[provider]) {
          const { data: connection, error } = await auth.supabase.from("google_connections")
            .select("id,status").eq("workspace_id", candidate.workspace_id)
            .eq("product", googleProducts[provider]).eq("status", "connected").limit(1).maybeSingle();
          if (error) throw error;
          if (!connection) return NextResponse.json({ error: "Connect and verify the " + provider + " integration before activating this workflow." }, { status: 409 });
        } else {
          const { data: connection, error } = await auth.supabase.from("workspace_integrations")
            .select("id,status,last_test_status").eq("workspace_id", candidate.workspace_id)
            .eq("provider", provider).maybeSingle();
          if (error) throw error;
          if (!connection || connection.status !== "connected" || connection.last_test_status !== "passed") {
            return NextResponse.json({ error: "Connect and successfully test the " + provider + " integration before activating this workflow." }, { status: 409 });
          }
        }
      }

      for (const step of steps) {
        const provider = getWorkerProvider(step);
        if (!provider) continue;
        const { data: approval, error } = await auth.supabase.from("workspace_provider_operation_approvals")
          .select("decision").eq("workspace_id", candidate.workspace_id)
          .eq("provider", provider).eq("node_id", step.nodeId).eq("operation_id", step.operationId)
          .order("decided_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle();
        if (error) throw error;
        if (!approval || approval.decision !== "approved") {
          return NextResponse.json({ error: "Approve " + provider + " / " + step.operationId + " in workspace integration permissions before activation." }, { status: 403 });
        }
      }
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
