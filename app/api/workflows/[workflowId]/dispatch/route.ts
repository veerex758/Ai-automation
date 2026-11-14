import { after, NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { hasWorkspacePermission } from "@/lib/supabase/permissions";
import { validateDefinition } from "@/lib/workflows/validate-definition.cjs";
import { runDurableWorker, validateDurableLiveSteps } from "@/lib/workflows/durable-worker";
import { findOperation } from "@/nodes/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

function isRegistryDefinition(value: unknown): boolean {
  if (!isRecord(value) || value.format !== "aivanta-registry-v1" ||
      !Array.isArray(value.steps) || value.steps.length < 1 || value.steps.length > 30) return false;
  const steps = value.steps;
  const seen = new Set<string>();
  if (steps.some((step) => {
    if (!isRecord(step) || typeof step.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(step.id) ||
        seen.has(step.id) || typeof step.nodeId !== "string" || typeof step.operationId !== "string" ||
        (step.kind !== "trigger" && step.kind !== "action") || !("input" in step) ||
        !findOperation(step.nodeId, step.operationId, step.kind)) return true;
    seen.add(step.id);
    return false;
  })) return false;
  return steps[0] && isRecord(steps[0]) && steps[0].kind === "trigger" &&
    steps.filter((step) => isRecord(step) && step.kind === "trigger").length === 1;
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.CODED_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.CODED_SUPABASE_SERVICE_ROLE_KEY ?? process.env.CODED_SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("QUEUE_DATABASE_NOT_CONFIGURED");
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export async function POST(request: NextRequest, context: { params: Promise<{ workflowId: string }> }) {
  try {
    const { workflowId } = await context.params;
    if (!uuidPattern.test(workflowId)) return NextResponse.json({ error: "Invalid workflow ID." }, { status: 400 });
    const idempotencyKey = request.headers.get("idempotency-key") ?? "";
    if (!uuidPattern.test(idempotencyKey)) return NextResponse.json({ error: "A UUID Idempotency-Key header is required." }, { status: 400 });

    const userDb = await createClient();
    const { data: { user }, error: authError } = await userDb.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

    let body: unknown;
    try { body = await request.json(); } catch {
      return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Request must be a JSON object." }, { status: 400 });
    const requestBody = body as Record<string, unknown>;
    const input = requestBody.input ?? {};
    const executionMode = requestBody.mode ?? "dry_run";
    if (executionMode !== "dry_run" && executionMode !== "live") {
      return NextResponse.json({ error: "Mode must be dry_run or live." }, { status: 400 });
    }
    if (executionMode === "live" && process.env.AIVANTA_LIVE_EXECUTION_ENABLED !== "true") {
      return NextResponse.json({ error: "Live execution is disabled by the server." }, { status: 503 });
    }
    if (!input || typeof input !== "object" || Array.isArray(input) || Buffer.byteLength(JSON.stringify(input), "utf8") > 10240) {
      return NextResponse.json({ error: "Input must be a JSON object no larger than 10 KB." }, { status: 400 });
    }

    const { data: workflow, error: workflowError } = await userDb.from("workflows")
      .select("id, workspace_id, version, definition, status")
      .eq("id", workflowId).maybeSingle();
    if (workflowError) throw workflowError;
    if (!workflow)
    if (workflow && !(await hasWorkspacePermission(userDb, workflow.workspace_id, user.id, "workflows.execute"))) return NextResponse.json({ error: "Workspace workflows.execute permission required." }, { status: 403 }); return NextResponse.json({ error: "Workflow not found or access denied." }, { status: 404 });
    if (workflow.status !== "active") return NextResponse.json({ error: "Only active workflows can be dispatched." }, { status: 409 });
    const registryFormat = isRecord(workflow.definition) && workflow.definition.format === "aivanta-registry-v1";
    if (registryFormat) {
      if (!isRegistryDefinition(workflow.definition)) {
        return NextResponse.json({ error: "Registry workflow definition is invalid." }, { status: 422 });
      }
      if (executionMode === "live") {
        const registrySteps = (workflow.definition as { steps: Parameters<typeof validateDurableLiveSteps>[0] }).steps;
        const livePolicyError = validateDurableLiveSteps(registrySteps);
        if (livePolicyError) {
          return NextResponse.json({ error: "This workflow is not approved for live execution.", code: livePolicyError }, { status: 403 });
        }
      }
    } else {
      const validated = validateDefinition(workflow.definition);
      if (!validated.definition) return NextResponse.json({ error: "Workflow definition is invalid." }, { status: 422 });
      if (executionMode === "live") {
        const nodes = validated.definition.nodes;
        const actions = nodes.filter((node) => node.type === "action");
        const emailAction = actions[0];
        if (nodes[0]?.type !== "trigger" || nodes[0].settings.event !== "manual" ||
            actions.length !== 1 || emailAction?.settings.provider !== "email" ||
            emailAction.settings.operation !== "send_email" || !emailAction.settings.message?.trim()) {
          return NextResponse.json({ error: "Durable legacy live execution currently supports one manual-trigger Resend email action." }, { status: 422 });
        }
        const allowedRecipients = new Set((process.env.AIVANTA_LIVE_EMAIL_RECIPIENTS ?? "")
          .split(",").map((item) => item.trim().toLowerCase()).filter(Boolean));
        const recipient = emailAction.settings.recipient?.trim().toLowerCase() ?? "";
        if (!recipient || recipient.includes("{{") || !allowedRecipients.has(recipient)) {
          return NextResponse.json({ error: "The email recipient must be a literal address on the server allowlist." }, { status: 403 });
        }
      }
    }

    const db = serviceClient();
    const { data, error } = await db.rpc("dispatch_workflow_execution", {
      p_workspace_id: workflow.workspace_id,
      p_workflow_id: workflow.id,
      p_workflow_version: workflow.version,
      p_created_by: user.id,
      p_idempotency_key: idempotencyKey,
      p_payload: { input },
      p_max_attempts: executionMode === "live" ? 1 : 5,
      p_execution_mode: executionMode,
    });
    if (error || !data || typeof data !== "object") throw error ?? new Error("DISPATCH_RESULT_INVALID");
    const result = data as { job_id: string; run_id: string; duplicate: boolean };
    // Wake the durable worker after the dispatch response is committed. The
    // queue remains the source of truth; a missed wake-up never loses the job.
    after(async () => {
      try {
        const workerResult = await runDurableWorker();
        console.info("Aivanta dispatch worker wake-up completed.", workerResult);
      } catch (workerError) {
        const errorCode = workerError instanceof Error && /^[A-Z0-9_]{1,64}$/.test(workerError.message)
          ? workerError.message : "WORKER_WAKEUP_FAILED";
        console.error("Aivanta dispatch worker wake-up failed.", { errorCode, jobId: result.job_id });
      }
    });
    return NextResponse.json({
      jobId: result.job_id, runId: result.run_id,
      status: result.duplicate ? "existing" : "queued",
      mode: executionMode,
      duplicate: result.duplicate,
    }, { status: result.duplicate ? 200 : 202 });
  } catch (error) {
    console.error("Aivanta workflow dispatch failed.", {
      errorCode: error instanceof Error && /^[A-Z0-9_]{1,64}$/.test(error.message) ? error.message : "DISPATCH_FAILED",
    });
    return NextResponse.json({ error: "Could not dispatch this workflow." }, { status: 500 });
  }
}
