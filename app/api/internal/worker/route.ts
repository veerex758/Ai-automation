import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { decryptWorkspaceCredentials, type WorkspaceCredentials } from "@/lib/integrations/workspace-credentials";
import { validateDefinition } from "@/lib/workflows/validate-definition.cjs";
import { runDryRun } from "@/lib/workflows/dry-run.cjs";
import { executeRegisteredWorkflow, type RegisteredWorkflowStep, type RegisteredStepResult } from "@/nodes/workflow-runner";
import type { NodeContext } from "@/nodes/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Job = {
  id: string; workspace_id: string; workflow_id: string; run_id: string;
  workflow_version: number; workflow_definition: Record<string, unknown>;
  execution_mode: "dry_run" | "live";
  payload: Record<string, unknown>; attempts: number; lease_token: string;
};

type DbClient = ReturnType<typeof client>;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET ?? process.env.AIVANTA_WORKER_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || ! key) throw new Error("WORKER_DATABASE_NOT_CONFIGURED");
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function workspaceCredentials(db: DbClient, workspaceId: string, providers: Set<string>): Promise<WorkspaceCredentials> {
  const credentials: WorkspaceCredentials = {};
  for (const provider of providers) {
    if (!["openai", "gemini", "resend", "slack", "http"].includes(provider)) {
      throw new Error("WORKSPACE_INTEGRATION_UNSUPPORTED");
    }
    const { data: integration, error: integrationError } = await db.from("workspace_integrations")
      .select("id,status").eq("workspace_id", workspaceId).eq("provider", provider).maybeSingle();
    if (integrationError) throw new Error("WORKSPACE_INTEGRATION_LOOKUP_FAILED");
    if (!integration || integration.status !== "connected") {
      throw new Error(provider === "resend" ? "EMAIL_CONNECTION_REQUIRED" : provider.toUpperCase() + "_CONNECTION_REQUIRED");
    }
    const { data: secret, error: secretError } = await db.from("workspace_integration_secrets")
      .select("encrypted_credentials,encryption_version").eq("integration_id", integration.id).maybeSingle();
    if (secretError) throw new Error("WORKSPACE_CREDENTIAL_LOOKUP_FAILED");
    if (!secret || secret.encryption_version !== "v1") throw new Error("WORKSPACE_CREDENTIALS_NOT_CONFIGURED");
    let decrypted: WorkspaceCredentials;
    try { decrypted = decryptWorkspaceCredentials(secret.encrypted_credentials); }
    catch { throw new Error("WORKSPACE_CREDENTIALS_DECRYPT_FAILED"); }
    if (!decrypted[provider]) throw new Error("WORKSPACE_CREDENTIAL_PROVIDER_MISMATCH");
    credentials[provider] = decrypted[provider];
  }
  return credentials;
}

function providerForStep(step: RegisteredWorkflowStep): string | null {
  if (step.nodeId === "openai" && step.operationId === "generate_text") return "openai";
  if (step.nodeId === "slack" && step.operationId === "send_message") return "slack";
  if (step.nodeId === "email" && step.operationId === "send_email") return "resend";
  return null;
}

function liveStepAllowed(step: RegisteredWorkflowStep): boolean {
  return (step.kind === "trigger" && step.nodeId === "manual" && step.operationId === "start") ||
    (step.kind === "action" && providerForStep(step) !== null);
}

function boundedOutput(value: unknown): Record<string, unknown> {
  if (isRecord(value)) {
    try {
      if (Buffer.byteLength(JSON.stringify(value), "utf8") <= 12000) return value;
    } catch { /* omit unserializable provider output */ }
  }
  return { outputOmitted: true };
}

function executionContext(credentials: WorkspaceCredentials, webhookVerified: boolean): Omit<NodeContext, "previousOutputs"> {
  return {
    credentials,
    logger: {
      info(message, meta) { console.info("[queue-node]", message, meta ?? {}); },
      error(message, meta) { console.error("[queue-node]", message, meta ?? {}); },
    },
    http: {
      async request(args) {
        const controller = new AbortController();
        const timeout = Math.max(1000, Math.min(args.timeoutMs ?? 15000, 30000));
        const timer = setTimeout(() => controller.abort(), timeout);
        try {
          const response = await fetch(args.url, {
            method: args.method,
            headers: args.headers,
            body: args.body === undefined ? undefined : JSON.stringify(args.body),
            signal: controller.signal,
            redirect: "error",
          });
          const raw = await response.text();
          let body: unknown = raw;
          try { body = raw ? JSON.parse(raw) : raw; } catch { /* preserve plain-text provider response */ }
          return { status: response.status, body };
        } finally { clearTimeout(timer); }
      },
    },
    webhook: { verified: webhookVerified },
  };
}

async function persistCheckpoint(
  db: DbClient, job: Job, step: RegisteredWorkflowStep, position: number,
  status: "started" | "succeeded" | "failed" | "skipped", output: Record<string, unknown> = {},
) {
  const { error } = await db.rpc("checkpoint_execution_step", {
    p_job_id: job.id, p_lease_token: job.lease_token,
    p_step_id: step.id, p_position: position, p_status: status,
    p_input: {}, p_output: output,
  });
  if (error) throw new Error("CHECKPOINT_WRITE_FAILED");
}

async function tick(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized or worker secret not configured." }, { status: 401 });
  let db: DbClient;
  try { db = client(); } catch {
    return NextResponse.json({ error: "Worker database access is not configured." }, { status: 503 });
  }

  const workerId = process.env.AIVANTA_WORKER_ID?.slice(0, 100) || "vercel-worker";
  const { data, error } = await db.rpc("claim_execution_jobs", {
    p_worker_id: workerId, p_limit: 5, p_lease_seconds: 120,
  });
  if (error || !Array.isArray(data)) {
    console.error("Aivanta worker could not claim jobs.");
    return NextResponse.json({ error: "Could not claim execution jobs." }, { status: 500 });
  }

  let succeeded = 0, retried = 0, deadLettered = 0, leaseLost = 0;
  for (const job of data as Job[]) {
    let outcome = "EXECUTION_FAILED";
    try {
      const definition = job.workflow_definition as Record<string, unknown>;
      if (job.execution_mode === "live" && process.env.AIVANTA_LIVE_EXECUTION_ENABLED !== "true") {
        throw new Error("LIVE_EXECUTION_DISABLED");
      }

      let result: { status: string; steps: Array<{ stepId: string; position: number; type: string; title: string; status: string; message: string; output?: unknown }> };
      if (definition.format === "aivanta-registry-v1") {
        if (!Array.isArray(definition.steps) || definition.steps.length < 1 || definition.steps.length > 30) {
          throw new Error("INVALID_REGISTRY_WORKFLOW_DEFINITION");
        }
        let steps = definition.steps as RegisteredWorkflowStep[];
        if (steps.some((step) => !step || typeof step.id !== "string" || typeof step.nodeId !== "string" ||
          typeof step.operationId !== "string" || (step.kind !== "trigger" && step.kind !== "action") || !("input" in step))) {
          throw new Error("INVALID_REGISTRY_WORKFLOW_DEFINITION");
        }
        if (job.execution_mode === "live") {
          if (steps.some((step) => !liveStepAllowed(step))) throw new Error("LIVE_OPERATION_NOT_ENABLED");
          const emailSteps = steps.filter((step) => step.nodeId === "email" && step.operationId === "send_email");
          const allowedRecipients = new Set((process.env.AIVANTA_LIVE_EMAIL_RECIPIENTS ?? "")
            .split(",").map((item) => item.trim().toLowerCase()).filter(Boolean));
          for (const step of emailSteps) {
            const to = isRecord(step.input) && typeof step.input.to === "string" ? step.input.to.trim().toLowerCase() : "";
            if (!to || to.includes("{{") || !allowedRecipients.has(to)) throw new Error("LIVE_EMAIL_RECIPIENT_NOT_ALLOWED");
          }
        }
        const source = job.payload?.source;
        if (source === "webhook" && (steps[0]?.kind !== "trigger" || steps[0]?.nodeId !== "webhooks" || steps[0]?.operationId !== "receive_event")) {
          throw new Error("INVALID_WEBHOOK_TRIGGER_DEFINITION");
        }
        if (job.execution_mode === "live" && source === "webhook") throw new Error("LIVE_DURABLE_WEBHOOK_NOT_ENABLED");
        if (job.execution_mode === "live" && steps[0]?.nodeId === "manual" && isRecord(job.payload?.input)) {
          steps = steps.map((step, index) => index === 0
            ? { ...step, input: { ...(isRecord(step.input) ? step.input : {}), ...(job.payload.input as Record<string, unknown>) } }
            : step);
        }
        const requiredProviders = new Set(steps.map(providerForStep).filter((value): value is string => Boolean(value)));
        const credentials = job.execution_mode === "live"
          ? await workspaceCredentials(db, job.workspace_id, requiredProviders)
          : {};
        const context = executionContext(credentials, job.payload?.webhookVerified === true);
        const registryResult = await executeRegisteredWorkflow({
          steps, context, dryRun: job.execution_mode !== "live",
          ...(job.execution_mode === "live" ? {
            onStepStart: async (step, position) => persistCheckpoint(db, job, step, position, "started"),
            onStepComplete: async (step, position, completed) => persistCheckpoint(
              db, job, step, position, completed.status === "succeeded" ? "succeeded" : "skipped",
              boundedOutput(completed.output),
            ),
          } : {}),
        });
        result = {
          status: registryResult.status,
          steps: registryResult.steps.map((step, index) => ({
            stepId: step.stepId, position: index + 1,
            type: steps[index]?.kind ?? "action",
            title: (steps[index]?.nodeId + "." + steps[index]?.operationId).slice(0, 80),
            status: step.status,
            message: step.error ?? (step.status === "succeeded" ? "Registered operation executed." : "Registered operation validated; no provider action was executed."),
            output: step.output,
          })),
        };
      } else {
        if (job.execution_mode === "live") throw new Error("LIVE_LEGACY_WORKFLOW_NOT_SUPPORTED");
        const validated = validateDefinition(definition);
        if (!validated.definition) throw new Error("INVALID_WORKFLOW_DEFINITION");
        const input = isRecord(job.payload?.input) ? job.payload.input : {};
        const legacyResult = runDryRun(validated.definition, input);
        if (legacyResult.sideEffectsPerformed !== false) throw new Error("UNSAFE_EXECUTOR_RESULT");
        result = {
          status: legacyResult.status,
          steps: legacyResult.steps.map((step) => ({
            stepId: step.stepId, position: step.position, type: step.type, title: step.title,
            status: step.status, message: step.message,
          })),
        };
      }

      for (const step of result.steps) {
        const registryStep = definition.format === "aivanta-registry-v1"
          ? (definition.steps as RegisteredWorkflowStep[]).find((item) => item.id === step.stepId)
          : null;
        if (registryStep && (job.execution_mode !== "live" || step.status !== "succeeded")) {
          const checkpointStatus = step.status === "skipped" ? "skipped" : step.status === "failed" ? "failed" : "succeeded";
          await persistCheckpoint(db, job, registryStep, step.position, checkpointStatus, { message: step.message });
        } else if (!registryStep) {
          const { error: checkpointError } = await db.rpc("checkpoint_execution_step", {
            p_job_id: job.id, p_lease_token: job.lease_token,
            p_step_id: step.stepId, p_position: step.position,
            p_status: step.status === "skipped" ? "skipped" : step.status === "failed" ? "failed" : "succeeded",
            p_input: {}, p_output: { message: step.message },
          });
          if (checkpointError) throw new Error("CHECKPOINT_WRITE_FAILED");
        }
      }

      const live = job.execution_mode === "live";
      const stepRows = result.steps.map((step) => ({
        run_id: job.run_id, workspace_id: job.workspace_id, step_id: step.stepId,
        position: step.position, step_type: step.type, title: step.title,
        status: step.status === "succeeded" ? (live ? "executed" : "simulated") : step.status,
        result: step.status === "failed" ? { error: step.message } : {
          message: step.message,
          ...(live && step.output !== undefined ? { output: boundedOutput(step.output) } : {}),
        },
      }));
      const { error: stepsError } = await db.from("workflow_run_steps").upsert(stepRows, { onConflict: "run_id,step_id" });
      if (stepsError) throw new Error("RUN_STEP_PERSISTENCE_FAILED");

      if (result.status !== "succeeded") throw new Error("WORKFLOW_STEP_FAILED");

      const { data: finished, error: finishError } = await db.rpc("finish_execution_job", {
        p_job_id: job.id, p_lease_token: job.lease_token, p_succeeded: true, p_error_code: null,
      });
      if (finishError || finished !== "succeeded") { leaseLost++; continue; }
      succeeded++;
    } catch (error) {
      outcome = error instanceof Error && /^[A-Z0-9_]{1,64}$/.test(error.message) ? error.message : "EXECUTION_FAILED";
      const { data: finished, error: finishError } = await db.rpc("finish_execution_job", {
        p_job_id: job.id, p_lease_token: job.lease_token, p_succeeded: false, p_error_code: outcome,
      });
      if (finishError || finished === "lease_lost") leaseLost++;
      else if (finished === "dead_letter") deadLettered++;
      else if (finished === "retry_wait") retried++;
      console.error("Aivanta execution job failed.", { jobId: job.id, errorCode: outcome });
    }
  }
  return NextResponse.json({ claimed: data.length, succeeded, retried, deadLettered, leaseLost });
}

export async function POST(request: NextRequest) { return tick(request); }
export async function GET(request: NextRequest) { return tick(request); }
