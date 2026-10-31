import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { executeRegisteredWorkflow, type RegisteredWorkflowStep } from "@/nodes/workflow-runner";
import type { NodeContext } from "@/nodes/types";
import { safeHttpsRequest } from "@/lib/workflows/safe-http-transport";
import { loadWorkspaceCredentials } from "@/lib/integrations/workspace-credentials";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

async function serverContext(workspaceId: string): Promise<Omit<NodeContext, "previousOutputs">> {
  const credentials = await loadWorkspaceCredentials(workspaceId);
  return {
    credentials,
    logger: {
      info(message, meta) { console.info("[registry-node]", message, meta ?? {}); },
      error(message, meta) { console.error("[registry-node]", message, meta ?? {}); },
    },
    http: {
      async request(args) {
        return safeHttpsRequest({
          url: args.url,
          method: args.method,
          headers: args.headers,
          body: args.body,
          timeoutMs: args.timeoutMs,
          retries: args.retries,
        });
      },
    },
  };
}

/** Registry-backed execution persisted in the same workflow_runs/workflow_run_steps history. */
export async function POST(request: NextRequest, context: { params: Promise<{ workflowId: string }> }) {
  const startedAt = Date.now();
  try {
    const { workflowId } = await context.params;
    if (!uuid.test(workflowId)) return NextResponse.json({ error: "Invalid workflow ID." }, { status: 400 });
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

    let body: unknown;
    try { body = await request.json(); } catch { return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 }); }
    if (!isRecord(body) || typeof body.dryRun !== "boolean") {
      return NextResponse.json({ error: "Provide dryRun as a boolean." }, { status: 400 });
    }
    const dryRun = body.dryRun;
    const idempotencyKey = request.headers.get("idempotency-key") ?? "";
    if (!dryRun && !uuid.test(idempotencyKey)) {
      return NextResponse.json({ error: "A UUID Idempotency-Key header is required for live execution." }, { status: 400 });
    }
    if (!dryRun && process.env.AIVANTA_LIVE_EXECUTION_ENABLED !== "true") {
      return NextResponse.json({ error: "Live execution is disabled by the server." }, { status: 503 });
    }

    const { data: workflow, error: workflowError } = await supabase.from("workflows")
      .select("id, workspace_id, version, definition, status")
      .eq("id", workflowId).maybeSingle();
    if (workflowError) throw workflowError;
    if (!workflow) return NextResponse.json({ error: "Workflow not found or you do not have access to it." }, { status: 404 });
    if (!dryRun && workflow.status !== "active") return NextResponse.json({ error: "Activate this workflow before live execution." }, { status: 409 });

    const definition = workflow.definition as { format?: unknown; steps?: unknown } | null;
    if (!definition || definition.format !== "aivanta-registry-v1" || !Array.isArray(definition.steps) || definition.steps.length < 1 || definition.steps.length > 30) {
      return NextResponse.json({ error: "This endpoint requires a saved aivanta-registry-v1 workflow definition." }, { status: 422 });
    }
    const steps = definition.steps as RegisteredWorkflowStep[];
    if (steps.some((step) => !isRecord(step) || typeof step.id !== "string" || typeof step.nodeId !== "string" ||
      typeof step.operationId !== "string" || !["trigger", "action"].includes(step.kind) || !("input" in step))) {
      return NextResponse.json({ error: "Registry workflow steps are malformed." }, { status: 422 });
    }
    if (steps[0]?.kind !== "trigger" || steps[0]?.nodeId !== "manual" || steps[0]?.operationId !== "start" ||
        steps.slice(1).some((step) => step.kind === "trigger")) {
      return NextResponse.json({ error: "A registry workflow must begin with a manual trigger and may not contain later trigger steps." }, { status: 422 });
    }
    if (!dryRun) {
      // Manual start and side-effect-free internal nodes are always eligible for a live run.
      // Every provider action needs an explicit server-side allowlist entry in addition to
      // workflow activation and AIVANTA_LIVE_EXECUTION_ENABLED=true.
      const internalActions = new Set(["logic", "data", "utilities", "date_time", "loop"]);
      const enabledActions = new Set((process.env.AIVANTA_LIVE_ENABLED_ACTIONS ?? "email.send_email")
        .split(",").map((item) => item.trim()).filter(Boolean));
      const unsupportedLiveStep = steps.find((step) =>
        (step.kind === "trigger" && !(step.nodeId === "manual" && step.operationId === "start")) ||
        (step.kind === "action" && !internalActions.has(step.nodeId) && !enabledActions.has(step.nodeId + "." + step.operationId))
      );
      if (unsupportedLiveStep) {
        return NextResponse.json({ error: "This registry operation is available in dry-run only until its live integration is explicitly enabled." }, { status: 403 });
      }
      const allowed = new Set((process.env.AIVANTA_LIVE_EMAIL_RECIPIENTS ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean));
      for (const step of steps) {
        if (step.nodeId === "email" && step.operationId === "send_email") {
          const rawTo = isRecord(step.input) && typeof step.input.to === "string" ? step.input.to.trim() : "";
          if (!rawTo || rawTo.includes("{{")) return NextResponse.json({ error: "Live email recipients must be literal addresses on the server-configured allowlist." }, { status: 403 });
          const to = rawTo.toLowerCase();
          if (!allowed.has(to)) return NextResponse.json({ error: "Email recipient is not on the server-configured live email allowlist." }, { status: 403 });
        }
      }
      const { data: prior } = await supabase.from("workflow_runs").select("id,status,mode,created_at")
        .eq("idempotency_key", idempotencyKey).eq("created_by", user.id).eq("workflow_id", workflowId).maybeSingle();
      if (prior) return NextResponse.json({ run: prior, duplicate: true }, { status: 200 });
      const hourAgo = new Date(Date.now() - 3600000).toISOString();
      const { count, error } = await supabase.from("workflow_runs").select("id", { count: "exact", head: true })
        .eq("created_by", user.id).eq("mode", "live").gte("created_at", hourAgo);
      if (error) throw error;
      if ((count ?? 0) >= 10) return NextResponse.json({ error: "Live run limit reached." }, { status: 429 });
    }

    // Current staging RLS requires dry-run parent rows to be inserted already finalized,
    // and only then permits their simulated/skipped step rows. Live runs use the running
    // -> finalized lifecycle so step inserts remain auditable before completion.
    const executionContext: Omit<NodeContext, "previousOutputs"> = dryRun
      ? {
          credentials: {},
          logger: {
            info(message, meta) { console.info("[registry-node]", message, meta ?? {}); },
            error(message, meta) { console.error("[registry-node]", message, meta ?? {}); },
          },
          http: { async request() { throw new Error("DRY_RUN_NETWORK_BLOCKED"); } },
        }
      : await serverContext(workflow.workspace_id);
    const dryRunExecution = dryRun
      ? await executeRegisteredWorkflow({ steps, context: executionContext, dryRun: true })
      : null;
    const initialStatus = dryRunExecution
      ? (dryRunExecution.status === "succeeded" ? "succeeded" : "failed")
      : "running";
    const initialCompletedAt = dryRunExecution ? new Date().toISOString() : null;
    const initialDuration = dryRunExecution ? Math.min(600000, Date.now() - startedAt) : 0;
    const { data: run, error: insertError } = await supabase.from("workflow_runs").insert({
      workspace_id: workflow.workspace_id, workflow_id: workflow.id, workflow_version: workflow.version,
      mode: dryRun ? "dry_run" : "live", status: initialStatus, created_by: user.id,
      idempotency_key: dryRun ? null : idempotencyKey, started_at: new Date(startedAt).toISOString(),
      completed_at: initialCompletedAt, duration_ms: initialDuration,
      error_message: dryRunExecution?.status === "failed" ? "One or more registered workflow steps failed." : null,
    }).select("id,mode,status,workflow_version,started_at,completed_at,duration_ms,error_message").single();
    if (insertError) throw insertError;

    const execution = dryRunExecution ?? await executeRegisteredWorkflow({ steps, context: executionContext, dryRun: false });
    const rows = execution.steps.map((step, index) => ({
      run_id: run.id, workspace_id: workflow.workspace_id, step_id: step.stepId, position: index + 1,
      step_type: steps[index]?.kind ?? "action", title: steps[index]?.nodeId + "." + steps[index]?.operationId,
      status: step.status === "succeeded" ? "executed" : step.status,
      result: step.status === "failed" ? { error: step.error } : step.status === "succeeded" ? step.output : { message: step.status === "simulated" ? "No provider action was executed." : step.error },
    }));
    const finalStatus = execution.status === "succeeded" ? "succeeded" : "failed";
    try {
      if (rows.length) {
        const { error } = await supabase.from("workflow_run_steps").insert(rows);
        if (error) throw error;
      }
      let finalized = run;
      if (!dryRun) {
        const { data, error } = await supabase.from("workflow_runs").update({
          status: finalStatus, completed_at: new Date().toISOString(), duration_ms: Math.min(600000, Date.now() - startedAt),
          error_message: execution.status === "failed" ? "One or more registered workflow steps failed." : null,
        }).eq("id", run.id).eq("status", "running")
          .select("id,mode,status,workflow_version,started_at,completed_at,duration_ms,error_message").single();
        if (error) throw error;
        finalized = data;
      }
      const executedSteps = execution.steps.filter((step) => step.status === "succeeded");
      const externalCallsPerformed = !dryRun && executedSteps.some((step) => {
        const definition = steps.find((candidate) => candidate.id === step.stepId);
        return Boolean(definition && ["openai", "gemini", "email", "slack", "http"].includes(definition.nodeId));
      });
      const sideEffectsPerformed = !dryRun && executedSteps.some((step) => {
        const definition = steps.find((candidate) => candidate.id === step.stepId);
        if (!definition) return false;
        if (definition.nodeId === "email" || definition.nodeId === "slack") return true;
        if (definition.nodeId === "http" && isRecord(definition.input)) return definition.input.method === "POST";
        return false;
      });
      return NextResponse.json({ run: finalized, steps: rows, externalCallsPerformed, sideEffectsPerformed }, { status: 201 });
    } catch (error) {
      console.error("Failed to persist registry workflow history", error);
      if (!dryRun) {
        await supabase.from("workflow_runs").update({
          status: "failed", completed_at: new Date().toISOString(), duration_ms: Math.min(600000, Date.now() - startedAt),
          error_message: "Run results could not be fully saved; an external side effect may already have occurred. Check provider delivery before retrying.",
        }).eq("id", run.id).eq("status", "running");
      }
      return NextResponse.json({
        error: "Run history could not be fully saved. Check run history before retrying.",
        runId: run.id, retrySafe: dryRun,
      }, { status: 500 });
    }
  } catch (error) {
    console.error("Registry workflow execution failed", error);
    return NextResponse.json({ error: "Could not complete this workflow run. Check run history before retrying." }, { status: 500 });
  }
}
