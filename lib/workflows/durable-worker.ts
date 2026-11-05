import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { decryptWorkspaceCredentials, type WorkspaceCredentials } from "@/lib/integrations/workspace-credentials";
import { decryptGoogleCredentials, encryptGoogleCredentials } from "@/lib/integrations/google-credentials";
import { validateDefinition } from "@/lib/workflows/validate-definition.cjs";
import { runDryRun } from "@/lib/workflows/dry-run.cjs";
import { executeRegisteredWorkflow, type RegisteredWorkflowStep } from "@/nodes/workflow-runner";
import { validateRegisteredSteps } from "@/nodes/validate-steps";
import type { NodeContext } from "@/nodes/types";


type Job = {
  id: string; workspace_id: string; workflow_id: string; run_id: string;
  workflow_version: number; workflow_definition: Record<string, unknown>;
  execution_mode: "dry_run" | "live";
  payload: Record<string, unknown>; attempts: number; lease_token: string;
};

type DbClient = ReturnType<typeof client>;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || ! key) throw new Error("WORKER_DATABASE_NOT_CONFIGURED");
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function googleAccessToken(db: DbClient, workspaceId: string, product: "gmail" | "sheets"): Promise<string> {
  const { data: connection, error } = await db.from("google_connections")
    .select("id,encrypted_credentials,expires_at,status,scopes")
    .eq("workspace_id", workspaceId).eq("product", product).eq("status", "connected")
    .order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error("GOOGLE_CONNECTION_LOOKUP_FAILED");
  if (!connection) throw new Error(product === "gmail" ? "GMAIL_CONNECTION_REQUIRED" : "GOOGLE_SHEETS_CONNECTION_REQUIRED");
  const requiredScope = product === "gmail"
    ? "https://www.googleapis.com/auth/gmail.readonly"
    : "https://www.googleapis.com/auth/spreadsheets.readonly";
  if (!Array.isArray(connection.scopes) || !connection.scopes.includes(requiredScope)) {
    throw new Error("GOOGLE_SCOPE_MISMATCH");
  }
  let credentials;
  try { credentials = decryptGoogleCredentials(connection.encrypted_credentials); }
  catch { throw new Error("GOOGLE_CREDENTIALS_DECRYPT_FAILED"); }
  const expiry = credentials.expiry_date ?? (connection.expires_at ? new Date(connection.expires_at).getTime() : 0);
  if (expiry > Date.now() + 60_000) return credentials.access_token;
  if (!credentials.refresh_token) throw new Error("GOOGLE_REAUTH_REQUIRED");
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GOOGLE_OAUTH_NOT_CONFIGURED");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: credentials.refresh_token, grant_type: "refresh_token" }),
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    await db.from("google_connections").update({ status: "needs_reauth", updated_at: new Date().toISOString() }).eq("id", connection.id);
    throw new Error("GOOGLE_REAUTH_REQUIRED");
  }
  const token = await response.json() as { access_token?: unknown; expires_in?: unknown; scope?: unknown; token_type?: unknown };
  if (typeof token.access_token !== "string" || typeof token.expires_in !== "number") throw new Error("GOOGLE_TOKEN_REFRESH_INVALID");
  const updated = {
    ...credentials, access_token: token.access_token, expiry_date: Date.now() + token.expires_in * 1000,
    ...(typeof token.scope === "string" ? { scope: token.scope } : {}),
    ...(typeof token.token_type === "string" ? { token_type: token.token_type } : {}),
  };
  const { error: saveError } = await db.from("google_connections").update({
    encrypted_credentials: encryptGoogleCredentials(updated),
    expires_at: new Date(updated.expiry_date).toISOString(),
    status: "connected", updated_at: new Date().toISOString(),
  }).eq("id", connection.id).eq("workspace_id", workspaceId);
  if (saveError) throw new Error("GOOGLE_TOKEN_REFRESH_SAVE_FAILED");
  return updated.access_token;
}

async function workspaceCredentials(db: DbClient, workspaceId: string, providers: Set<string>): Promise<WorkspaceCredentials> {
  const credentials: WorkspaceCredentials = {};
  for (const provider of providers) {
    if (provider === "gmail" || provider === "sheets") {
      credentials[provider] = { accessToken: await googleAccessToken(db, workspaceId, provider) };
      continue;
    }
    if (!["openai", "gemini", "resend", "slack", "http", "notion", "hubspot", "twilio", "shopify", "stripe", "linear", "elevenlabs", "stability_ai", "hugging_face", "pinecone", "microsoft_teams", "salesforce", "pipedrive", "zoho_crm", "freshsales", "close", "apollo", "intercom"].includes(provider)) {
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
    try { decrypted = decryptWorkspaceCredentials(secret.encrypted_credentials, undefined, `${workspaceId}:${provider}`); }
    catch { throw new Error("WORKSPACE_CREDENTIALS_DECRYPT_FAILED"); }
    if (!decrypted[provider]) throw new Error("WORKSPACE_CREDENTIAL_PROVIDER_MISMATCH");
    credentials[provider] = decrypted[provider];
  }
  return credentials;
}

function providerForStep(step: RegisteredWorkflowStep): string | null {
  if (step.nodeId === "openai" && step.operationId === "generate_text") return "openai";
  if (step.nodeId === "gemini" && step.operationId === "generate_text") return "gemini";
  if (step.nodeId === "slack" && ["send_message", "post_message"].includes(step.operationId)) return "slack";
  if (step.nodeId === "email" && step.operationId === "send_email") return "resend";
  if (step.nodeId === "gmail" && step.operationId === "list_messages") return "gmail";
  if (step.nodeId === "google_sheets" && step.operationId === "get_values") return "sheets";
  if (step.nodeId === "notion" && step.operationId === "create_page") return "notion";
  if (step.nodeId === "hubspot" && step.operationId === "create_contact") return "hubspot";
  if (step.nodeId === "twilio" && step.operationId === "send_sms") return "twilio";
  if (step.nodeId === "shopify" && step.operationId === "list_products") return "shopify";
  if (step.nodeId === "stripe" && step.operationId === "create_customer") return "stripe";
  if (step.nodeId === "linear" && step.operationId === "create_issue") return "linear";
  if (["elevenlabs", "stability_ai", "hugging_face", "pinecone", "microsoft_teams", "salesforce", "pipedrive", "zoho_crm", "freshsales", "close", "apollo", "intercom"].includes(step.nodeId) && step.operationId === "execute") return step.nodeId;
  if (step.nodeId === "http_request" && step.operationId === "request") return "http";
  return null;
}

const SERVER_ENABLED_INTEGRATIONS = new Set(["gmail", "sheets", "notion", "hubspot", "twilio", "shopify", "stripe", "linear", "http", "elevenlabs", "stability_ai", "hugging_face", "pinecone", "microsoft_teams", "salesforce", "pipedrive", "zoho_crm", "freshsales", "close", "apollo", "intercom"]);
function liveStepAllowed(step: RegisteredWorkflowStep): boolean {
  if (step.kind === "action" && step.nodeId === "javascript" && step.operationId === "execute") {
    return process.env.AIVANTA_JAVASCRIPT_SANDBOX_ENABLED === "true";
  }
  if (step.kind === "trigger" && ((step.nodeId === "manual" && step.operationId === "start") || (step.nodeId === "schedule" && step.operationId === "scheduled"))) return true;
  if (step.kind === "action" && new Set(["if.evaluate", "switch.select_route", "merge.merge_inputs", "set_fields.merge_fields", "json_parse.parse", "filter.filter_items", "aggregate.calculate", "date_time.current_time", "loop.iterate", "wait.delay"]).has(step.nodeId + "." + step.operationId)) return true;
  const provider = step.kind === "action" ? providerForStep(step) : null;
  if (!provider) return false;
  if (SERVER_ENABLED_INTEGRATIONS.has(provider) || (step.nodeId === "slack" && step.operationId === "post_message")) {
    const enabled = new Set((process.env.AIVANTA_LIVE_INTEGRATIONS ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean));
    return enabled.has(provider);
  }
  return true;
}

function boundedOutput(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) {
    try {
      if (Buffer.byteLength(JSON.stringify(value), "utf8") <= 12000) return { __aivantaArray: value };
    } catch { /* omit unserializable loop output */ }
  }
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
            body: args.body === undefined ? undefined : (typeof args.body === "string" ? args.body : JSON.stringify(args.body)),
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

export async function runDurableWorker() {
  let db: DbClient;
  try { db = client(); } catch {
    throw new Error("WORKER_DATABASE_NOT_CONFIGURED");
  }

  const workerId = process.env.AIVANTA_WORKER_ID?.slice(0, 100) || "vercel-worker";
  const { data, error } = await db.rpc("claim_execution_jobs", {
    p_worker_id: workerId, p_limit: 1, p_lease_seconds: 120,
  });
  if (error || !Array.isArray(data)) {
    console.error("Aivanta worker could not claim jobs.");
    throw new Error("WORKER_CLAIM_FAILED");
  }

  let succeeded = 0, retried = 0, deadLettered = 0, leaseLost = 0;
  for (const job of data as Job[]) {
    let outcome = "EXECUTION_FAILED";
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    let heartbeatInFlight = false;
    try {
      heartbeatTimer = setInterval(() => {
        if (heartbeatInFlight) return;
        heartbeatInFlight = true;
        void (async () => {
          try {
            const { data: renewed, error: heartbeatError } = await db.rpc("heartbeat_execution_job", {
              p_job_id: job.id, p_lease_token: job.lease_token, p_lease_seconds: 120,
            });
            if (heartbeatError || renewed !== true) {
              console.warn("Aivanta worker heartbeat was not renewed.", { jobId: job.id });
            }
          } catch {
            console.warn("Aivanta worker heartbeat failed.", { jobId: job.id });
          } finally {
            heartbeatInFlight = false;
          }
        })();
      }, 30_000);
      heartbeatTimer.unref?.();
      const definition = job.workflow_definition as Record<string, unknown>;
      if (job.execution_mode === "live" && process.env.AIVANTA_LIVE_EXECUTION_ENABLED !== "true") {
        throw new Error("LIVE_EXECUTION_DISABLED");
      }

      let result: { status: string; steps: Array<{ stepId: string; position: number; type: string; title: string; status: string; message: string; output?: unknown }> };
      const preCheckpointed = new Set<string>();
      if (definition.format === "aivanta-registry-v1") {
        const validated = validateRegisteredSteps(definition.steps);
        if (!validated.steps) throw new Error("INVALID_REGISTRY_WORKFLOW_DEFINITION");
        let steps: RegisteredWorkflowStep[] = validated.steps;
        if (job.execution_mode === "live") {
          if (steps.some((step) => !liveStepAllowed(step)) || steps.filter((step) => step.kind === "action").length > 4) {
            throw new Error("LIVE_OPERATION_NOT_ENABLED");
          }
          const smsSteps = steps.filter((step) => step.nodeId === "twilio" && step.operationId === "send_sms");
          const allowedSmsRecipients = new Set((process.env.AIVANTA_LIVE_SMS_RECIPIENTS ?? "")
            .split(",").map((item) => item.trim()).filter(Boolean));
          for (const step of smsSteps) {
            const to = isRecord(step.input) && typeof step.input.to === "string" ? step.input.to.trim() : "";
            if (!to || to.includes("{{") || !allowedSmsRecipients.has(to)) throw new Error("LIVE_SMS_RECIPIENT_NOT_ALLOWED");
          }
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
        if (source === "schedule" && (steps[0]?.kind !== "trigger" || steps[0]?.nodeId !== "schedule" || steps[0]?.operationId !== "scheduled")) {
          throw new Error("INVALID_SCHEDULE_TRIGGER_DEFINITION");
        }
        if (job.execution_mode === "live" && source === "webhook") throw new Error("LIVE_DURABLE_WEBHOOK_NOT_ENABLED");
        if (isRecord(job.payload?.input) && (source === "schedule" || (job.execution_mode === "live" && steps[0]?.nodeId === "manual"))) {
          steps = steps.map((step, index) => index === 0
            ? { ...step, input: { ...(isRecord(step.input) ? step.input : {}), ...(job.payload.input as Record<string, unknown>) } }
            : step);
        }
        const requiredProviders = new Set(steps.map(providerForStep).filter((value): value is string => Boolean(value)));
        const credentials = job.execution_mode === "live"
          ? await workspaceCredentials(db, job.workspace_id, requiredProviders)
          : {};
        const context = executionContext(credentials, job.payload?.webhookVerified === true);
        const { data: savedCheckpoints, error: checkpointReadError } = await db.from("execution_checkpoints")
          .select("step_id,status,output").eq("job_id", job.id).eq("status", "succeeded");
        if (checkpointReadError || !Array.isArray(savedCheckpoints)) throw new Error("CHECKPOINT_READ_FAILED");
        const workflowStepIds = new Set(steps.map((step) => step.id));
        const initialOutputs: Record<string, unknown> = {};
        const completedStepIds: string[] = [];
        for (const checkpoint of savedCheckpoints as Array<{ step_id: string; output: unknown }>) {
          if (workflowStepIds.has(checkpoint.step_id)) {
            initialOutputs[checkpoint.step_id] = isRecord(checkpoint.output) && Array.isArray(checkpoint.output.__aivantaArray)
              ? checkpoint.output.__aivantaArray : checkpoint.output;
            completedStepIds.push(checkpoint.step_id);
          }
        }
        const registryResult = await executeRegisteredWorkflow({
          steps, context, dryRun: job.execution_mode !== "live", initialOutputs, completedStepIds,
          ...(job.execution_mode === "live" ? {
            onStepStart: async (step, position) => persistCheckpoint(db, job, step, position, "started"),
            onStepComplete: async (step, position, completed) => persistCheckpoint(
              db, job, step, position, completed.status === "succeeded" ? "succeeded" : "skipped",
              boundedOutput(completed.output),
            ),
          } : {}),
        });
        if (registryResult.status === "waiting") {
          const remainingMs = Math.max(1000, Date.parse(registryResult.resumeAt ?? "") - Date.now());
          const { data: paused, error: pauseError } = await db.rpc("pause_execution_job", {
            p_job_id: job.id, p_lease_token: job.lease_token,
            p_delay_seconds: Math.min(2592000, Math.ceil(remainingMs / 1000)),
          });
          if (pauseError || paused !== true) throw new Error("EXECUTION_PAUSE_FAILED");
          retried++;
          continue;
        }
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
        const validated = validateDefinition(definition);
        if (!validated.definition) throw new Error("INVALID_WORKFLOW_DEFINITION");
        const input = isRecord(job.payload?.input) ? job.payload.input : {};
        const legacyResult = runDryRun(validated.definition, input);
        if (legacyResult.sideEffectsPerformed !== false) throw new Error("UNSAFE_EXECUTOR_RESULT");

        if (job.execution_mode !== "live") {
          result = {
            status: legacyResult.status,
            steps: legacyResult.steps.map((step) => ({
              stepId: step.stepId, position: step.position, type: step.type, title: step.title,
              status: step.status, message: step.message,
            })),
          };
        } else {
          const nodes = validated.definition.nodes;
          const trigger = nodes[0];
          const actions = nodes.filter((node) => node.type === "action");
          const emailAction = actions[0];
          if (trigger?.type !== "trigger" || trigger.settings.event !== "manual" ||
              actions.length !== 1 || emailAction?.settings.provider !== "email" ||
              emailAction.settings.operation !== "send_email") {
            throw new Error("LIVE_LEGACY_OPERATION_NOT_ENABLED");
          }
          const recipient = typeof emailAction.settings.recipient === "string"
            ? emailAction.settings.recipient.trim().toLowerCase() : "";
          const message = typeof emailAction.settings.message === "string" ? emailAction.settings.message.trim() : "";
          const allowedRecipients = new Set((process.env.AIVANTA_LIVE_EMAIL_RECIPIENTS ?? "")
            .split(",").map((item) => item.trim().toLowerCase()).filter(Boolean));
          if (!recipient || recipient.includes("{{") || !allowedRecipients.has(recipient)) {
            throw new Error("LIVE_EMAIL_RECIPIENT_NOT_ALLOWED");
          }
          if (!message) throw new Error("LIVE_EMAIL_MESSAGE_REQUIRED");

          let sentOutput: unknown = undefined;
          let sendFailed: string | null = legacyResult.status === "succeeded" ? null : "WORKFLOW_PREVIEW_FAILED";
          const emailPreview = legacyResult.steps.find((step) => step.stepId === emailAction.id);
          if (!emailPreview) sendFailed = "EMAIL_PREVIEW_STEP_MISSING";
          if (legacyResult.status === "succeeded" && emailPreview?.status === "simulated") {
            const credentials = await workspaceCredentials(db, job.workspace_id, new Set(["resend"]));
            const registrySteps: RegisteredWorkflowStep[] = [
              { id: trigger.id, nodeId: "manual", operationId: "start", kind: "trigger", input },
              {
                id: emailAction.id, nodeId: "email", operationId: "send_email", kind: "action",
                input: { to: recipient, subject: "Aivanta workflow message", text: message },
              },
            ];
            const liveResult = await executeRegisteredWorkflow({
              steps: registrySteps,
              context: executionContext(credentials, false),
              dryRun: false,
              onStepStart: async (step, position) => {
                await persistCheckpoint(db, job, step, position, "started");
                preCheckpointed.add(step.id);
              },
              onStepComplete: async (step, position, completed) => {
                await persistCheckpoint(db, job, step, position, "succeeded", boundedOutput(completed.output));
                preCheckpointed.add(step.id);
              },
            });
            const emailResult = liveResult.steps.find((step) => step.stepId === emailAction.id);
            sentOutput = emailResult?.output;
            sendFailed = liveResult.status !== "succeeded"
              ? liveResult.steps.find((step) => step.status === "failed")?.error ?? "LIVE_WORKFLOW_FAILED"
              : null;
          }

          result = {
            status: legacyResult.status === "succeeded" && !sendFailed ? "succeeded" : "failed",
            steps: legacyResult.steps.map((step) => {
              if (step.stepId === trigger.id) return {
                stepId: step.stepId, position: step.position, type: step.type, title: step.title,
                status: "succeeded", message: "Manual workflow trigger accepted.",
              };
              if (step.stepId === emailAction.id) {
                if (step.status === "skipped") return {
                  stepId: step.stepId, position: step.position, type: step.type, title: step.title,
                  status: "skipped", message: step.message,
                };
                if (sendFailed) return {
                  stepId: step.stepId, position: step.position, type: step.type, title: step.title,
                  status: "failed", message: sendFailed,
                };
                return {
                  stepId: step.stepId, position: step.position, type: step.type, title: step.title,
                  status: "succeeded", message: "Resend accepted the workflow email.", output: sentOutput,
                };
              }
              return {
                stepId: step.stepId, position: step.position, type: step.type, title: step.title,
                status: step.status === "skipped" ? "skipped" : "succeeded",
                message: step.message,
              };
            }),
          };
        }
      }

      for (const step of result.steps) {
        const registryStep = definition.format === "aivanta-registry-v1"
          ? (definition.steps as RegisteredWorkflowStep[]).find((item) => item.id === step.stepId)
          : null;
        if (registryStep && (job.execution_mode !== "live" || step.status !== "succeeded")) {
          const checkpointStatus = step.status === "skipped" ? "skipped" : step.status === "failed" ? "failed" : "succeeded";
          await persistCheckpoint(db, job, registryStep, step.position, checkpointStatus, { message: step.message });
        } else if (!registryStep && !(job.execution_mode === "live" && step.status === "succeeded" && preCheckpointed.has(step.stepId))) {
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
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    }
  }
  return { claimed: data.length, succeeded, retried, deadLettered, leaseLost };
}
