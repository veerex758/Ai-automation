import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { decryptWorkspaceCredentials, encryptWorkspaceCredentials, type WorkspaceCredentials } from "@/lib/integrations/workspace-credentials";
import { PROVIDER_OAUTH_CONFIG, refreshProviderOAuthToken } from "@/lib/integrations/provider-oauth";
import { decryptGoogleCredentials, encryptGoogleCredentials } from "@/lib/integrations/google-credentials";
import { GOOGLE_PRODUCTS, type GoogleProduct } from "@/lib/integrations/google-oauth";
import { validateDefinition } from "@/lib/workflows/validate-definition.cjs";
import { runDryRun } from "@/lib/workflows/dry-run.cjs";
import { executeRegisteredWorkflow, type RegisteredWorkflowStep } from "@/nodes/workflow-runner";
import { validateRegisteredSteps } from "@/nodes/validate-steps";
import type { NodeContext } from "@/nodes/types";
import { isProviderLiveEnabled, providerPackLiveId } from "@/lib/workflows/provider-live-gates";
import { performSafeHttpRequest } from "@/nodes/safe-http";
import { getWorkerOperationMapping, getWorkerProvider } from "@/lib/workflows/worker-operation-map";
import { redactSensitiveData } from "@/lib/integrations/redact-sensitive";


type Job = {
  id: string; workspace_id: string; workflow_id: string; run_id: string;
  workflow_version: number; workflow_definition: Record<string, unknown>;
  execution_mode: "dry_run" | "live";
  payload: Record<string, unknown>; attempts: number; lease_token: string;
};

type DbClient = ReturnType<typeof client>;
const MAX_LIVE_ACTION_STEPS = 30;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.CODED_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.CODED_SUPABASE_SERVICE_ROLE_KEY ?? process.env.CODED_SUPABASE_SECRET_KEY;
  if (!url || ! key) throw new Error("WORKER_DATABASE_NOT_CONFIGURED");
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function googleAccessToken(db: DbClient, workspaceId: string, product: GoogleProduct): Promise<string> {
  const { data: connection, error } = await db.from("google_connections")
    .select("id,encrypted_credentials,expires_at,status,scopes")
    .eq("workspace_id", workspaceId).eq("product", product).eq("status", "connected")
    .order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error("GOOGLE_CONNECTION_LOOKUP_FAILED");
  if (!connection) throw new Error(product.toUpperCase() + "_CONNECTION_REQUIRED");
  const requiredScope = GOOGLE_PRODUCTS[product].scopes[0];
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
    const googleProductByProvider: Record<string, GoogleProduct> = {
      gmail: "gmail", sheets: "sheets", google_drive: "drive", google_calendar: "calendar",
      google_docs: "docs", google_forms: "forms", youtube: "youtube", google_contacts: "contacts",
    };
    const googleProduct = googleProductByProvider[provider];
    if (provider === "rss_feed") { credentials[provider] = {}; continue; }
    if (googleProduct) {
      credentials[provider] = { accessToken: await googleAccessToken(db, workspaceId, googleProduct) };
      continue;
    }
    if (!["openai", "gemini", "resend", "slack", "http", "notion", "hubspot", "twilio", "shopify", "stripe", "linear", "elevenlabs", "stability_ai", "hugging_face", "pinecone", "microsoft_teams", "salesforce", "pipedrive", "zoho_crm", "freshsales", "close", "apollo", "intercom", "jira", "asana", "trello", "clickup", "monday", "todoist", "airtable", "bitbucket", "netlify", "woocommerce", "paypal", "paddle", "lemon_squeezy", "square", "razorpay", "zoom", "cal_com", "twilio_voice", "docusign", "x_twitter", "linkedin", "facebook_pages", "instagram", "tiktok", "mailchimp", "typeform", "supabase", "postgresql", "mysql", "mongodb", "redis", "firebase", "dropbox", "aws_s3", "cloudflare_r2", "claude", "mistral", "groq", "perplexity", "discord", "telegram", "whatsapp_business", "sendgrid", "mailgun", "postmark", "github", "gitlab", "sentry", "vercel", "calendly", "zendesk", "freshdesk", "serpapi", "openweather"].includes(provider)) {
      throw new Error("WORKSPACE_INTEGRATION_UNSUPPORTED");
    }
    const { data: integration, error: integrationError } = await db.from("workspace_integrations")
      .select("id,status,last_test_status").eq("workspace_id", workspaceId).eq("provider", provider).maybeSingle();
    if (integrationError) throw new Error("WORKSPACE_INTEGRATION_LOOKUP_FAILED");
    if (!integration || integration.status !== "connected" || integration.last_test_status !== "passed") {
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
    let providerCredentials = decrypted[provider];
    const oauthConfig = PROVIDER_OAUTH_CONFIG[provider];
    if (oauthConfig && providerCredentials.expiresAt) {
      const expiry = Date.parse(providerCredentials.expiresAt);
      if (!Number.isFinite(expiry)) throw new Error("OAUTH_CREDENTIAL_EXPIRY_INVALID");
      if (expiry <= Date.now() + 60_000) {
        try {
          if (!providerCredentials.refreshToken) throw new Error("OAUTH_REAUTH_REQUIRED");
          const refreshed = await refreshProviderOAuthToken({
            provider, config: oauthConfig, refreshToken: providerCredentials.refreshToken,
          });
          if (typeof refreshed.expires_in !== "number" || !Number.isFinite(refreshed.expires_in)) {
            throw new Error("OAUTH_TOKEN_RESPONSE_INVALID");
          }
          providerCredentials = {
            ...providerCredentials,
            accessToken: refreshed.access_token,
            refreshToken: typeof refreshed.refresh_token === "string" ? refreshed.refresh_token : providerCredentials.refreshToken,
            expiresAt: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
            ...(typeof refreshed.token_type === "string" ? { tokenType: refreshed.token_type } : {}),
            ...(typeof refreshed.scope === "string" ? { scope: refreshed.scope } : {}),
          };
          const encrypted = encryptWorkspaceCredentials({ [provider]: providerCredentials }, undefined, `${workspaceId}:${provider}`);
          const { error: refreshSaveError } = await db.from("workspace_integration_secrets").update({
            encrypted_credentials: encrypted, encryption_version: "v1", updated_at: new Date().toISOString(),
          }).eq("integration_id", integration.id);
          if (refreshSaveError) throw new Error("OAUTH_TOKEN_REFRESH_SAVE_FAILED");
        } catch {
          await db.from("workspace_integrations").update({ status: "needs_reauth", last_tested_at: null, last_test_status: null })
            .eq("id", integration.id).eq("workspace_id", workspaceId);
          throw new Error("OAUTH_REAUTH_REQUIRED");
        }
      }
    }
    credentials[provider] = providerCredentials;
  }
  return credentials;
}

function providerForStep(step: RegisteredWorkflowStep): string | null {
  return providerPackLiveId(step) ?? getWorkerProvider(step);
}

function liveStepAllowed(step: RegisteredWorkflowStep): boolean {
  if (step.kind === "action" && step.nodeId === "javascript" && step.operationId === "execute") {
    return process.env.AIVANTA_JAVASCRIPT_SANDBOX_ENABLED === "true";
  }
  if (step.kind === "trigger" && step.nodeId === "webhooks" && step.operationId === "receive_event") return process.env.AIVANTA_DURABLE_WEBHOOK_LIVE_ENABLED === "true";
  if (step.kind === "trigger" && ((step.nodeId === "manual" && step.operationId === "start") || (step.nodeId === "schedule" && step.operationId === "scheduled") || (step.nodeId === "error_trigger" && step.operationId === "capture"))) return true;
  if (step.kind === "action" && new Set([
    "if.evaluate", "switch.select_route", "merge.merge_inputs", "set_fields.merge_fields",
    "json_parse.parse", "filter.filter_items", "aggregate.calculate", "date_time.current_time",
    "loop.iterate", "wait.delay",
    "deduplicate.unique", "sort.sort_items", "split_batches.split", "crypto_hash.hash",
    "template.render", "csv_parse.parse", "csv_stringify.stringify", "markdown_html.convert",
    "text_transform.transform", "regex.match", "array_ops.operate", "object_ops.operate",
    "math.calculate", "uuid.generate", "base64.convert", "date_add.add", "date_format.format",
    "rate_limiter.check", "json_encode.encode",
  ]).has(step.nodeId + "." + step.operationId)) return true;
  const providerPackProvider = providerPackLiveId(step);
  if (providerPackProvider) return isProviderLiveEnabled(providerPackProvider, process.env.AIVANTA_LIVE_INTEGRATIONS);
  const provider = step.kind === "action" ? providerForStep(step) : null;
  if (!provider) return false;
  // Every external provider, including OpenAI, Gemini, Resend and both Slack
  // actions, must have its own explicit server-side opt-in. Unknown paths fail closed.
  return isProviderLiveEnabled(provider, process.env.AIVANTA_LIVE_INTEGRATIONS);
}

export function validateDurableLiveSteps(steps: RegisteredWorkflowStep[]): string | null {
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > 30 ||
      steps.filter((step) => step.kind === "action").length > MAX_LIVE_ACTION_STEPS) {
    return "LIVE_WORKFLOW_STEP_LIMIT_EXCEEDED";
  }
  if (steps.some((step) => !liveStepAllowed(step))) return "LIVE_OPERATION_NOT_ENABLED";

  const smsSteps = steps.filter((step) => step.nodeId === "twilio" && step.operationId === "send_sms");
  const allowedSmsRecipients = new Set((process.env.AIVANTA_LIVE_SMS_RECIPIENTS ?? "")
    .split(",").map((item) => item.trim()).filter(Boolean));
  for (const step of smsSteps) {
    const to = isRecord(step.input) && typeof step.input.to === "string" ? step.input.to.trim() : "";
    if (!/^\+[1-9]\d{7,14}$/.test(to) || !allowedSmsRecipients.has(to)) return "LIVE_SMS_RECIPIENT_NOT_ALLOWED";
  }

  const emailSteps = steps.filter((step) => step.nodeId === "email" && step.operationId === "send_email");
  const allowedEmailRecipients = new Set((process.env.AIVANTA_LIVE_EMAIL_RECIPIENTS ?? "")
    .split(",").map((item) => item.trim().toLowerCase()).filter(Boolean));
  for (const step of emailSteps) {
    const to = isRecord(step.input) && typeof step.input.to === "string" ? step.input.to.trim().toLowerCase() : "";
    if (!to || to.includes("{{") || !allowedEmailRecipients.has(to)) return "LIVE_EMAIL_RECIPIENT_NOT_ALLOWED";
  }

  const voiceSteps = steps.filter((step) => step.nodeId === "twilio_voice" && step.operationId === "execute");
  const allowedVoiceRecipients = new Set((process.env.AIVANTA_LIVE_VOICE_RECIPIENTS ?? "")
    .split(",").map((item) => item.trim()).filter(Boolean));
  for (const step of voiceSteps) {
    const to = isRecord(step.input) && typeof step.input.to === "string" ? step.input.to.trim() : "";
    if (!/^\+[1-9]\d{7,14}$/.test(to) || !allowedVoiceRecipients.has(to)) return "LIVE_VOICE_RECIPIENT_NOT_ALLOWED";
  }

  const publishingSteps = steps.filter((step) =>
    ["x_twitter", "facebook_pages", "instagram"].includes(step.nodeId) && step.operationId === "execute");
  if (publishingSteps.length && process.env.AIVANTA_LIVE_PUBLISHING_ENABLED !== "true") {
    return "LIVE_PUBLISHING_NOT_ENABLED";
  }
  return null;
}

function safeWebhookTriggerOutput(job: Job): Record<string, unknown> {
  const input = isRecord(job.payload?.input) ? job.payload.input : {};
  return {
    eventId: typeof input.eventId === "string" ? input.eventId : "omitted",
    eventType: typeof input.eventType === "string" ? input.eventType : "omitted",
    receivedAt: typeof input.receivedAt === "string" ? input.receivedAt : "omitted",
    payloadSha256: typeof job.payload.payloadSha256 === "string" ? job.payload.payloadSha256 : "omitted",
  };
}
function boundedOutput(value: unknown, knownSecrets: readonly string[] = []): Record<string, unknown> {
  const safe = redactSensitiveData(value, knownSecrets);
  if (Array.isArray(safe)) {
    try {
      if (Buffer.byteLength(JSON.stringify(safe), "utf8") <= 12000) return { __aivantaArray: safe };
    } catch { /* omit unserializable loop output */ }
  }
  if (isRecord(safe)) {
    try {
      if (Buffer.byteLength(JSON.stringify(safe), "utf8") <= 12000) return safe;
    } catch { /* omit unserializable provider output */ }
  }
  return { outputOmitted: true };
}

function knownCredentialValues(credentials: WorkspaceCredentials): string[] {
  const secretField = /(?:token|key|secret|password|credential|webhook|connection.?string|authorization)/i;
  return Object.values(credentials).flatMap((provider) =>
    Object.entries(provider)
      .filter(([field, value]) => secretField.test(field) && typeof value === "string" && value.length >= 4)
      .map(([, value]) => value));
}

function executionContext(credentials: WorkspaceCredentials, webhookVerified: boolean, db: DbClient, workspaceId: string, job: Job, leaseState: { lost: boolean; cancelled: boolean; controller: AbortController }): Omit<NodeContext, "previousOutputs"> {
  return {
    credentials,
    signal: leaseState.controller.signal,
    logger: {
      info(message, meta) { console.info("[queue-node]", redactSensitiveData(message, knownCredentialValues(credentials)), redactSensitiveData(meta ?? {}, knownCredentialValues(credentials))); },
      error(message, meta) { console.error("[queue-node]", redactSensitiveData(message, knownCredentialValues(credentials)), redactSensitiveData(meta ?? {}, knownCredentialValues(credentials))); },
    },
    http: {
      async request(args) {
        const timeoutMs = Math.max(1000, Math.min(args.timeoutMs ?? 15000, 30000));
        const response = await performSafeHttpRequest({
          url: args.url,
          method: args.method,
          headers: args.headers ?? {},
          body: args.body,
          timeoutMs,
          signal: leaseState.controller.signal,
        });
        return { status: response.status, body: response.body };
      },
    },
    authorizeOperation: async ({ nodeId, operationId, kind }) => {
      if (leaseState.cancelled) throw new Error("EXECUTION_CANCELLED");
      if (leaseState.lost || leaseState.controller.signal.aborted) throw new Error("EXECUTION_LEASE_LOST");
      const { data: cancellation, error: cancellationError } = await db.from("execution_jobs")
        .select("cancel_requested_at").eq("id", job.id).eq("lease_token", job.lease_token).maybeSingle();
      if (cancellationError) throw new Error("EXECUTION_LEASE_CHECK_FAILED");
      if (cancellation?.cancel_requested_at) {
        leaseState.cancelled = true;
        leaseState.controller.abort(new Error("EXECUTION_CANCELLED"));
        throw new Error("EXECUTION_CANCELLED");
      }
      const { data: renewed, error: leaseError } = await db.rpc("heartbeat_execution_job", {
        p_job_id: job.id, p_lease_token: job.lease_token, p_lease_seconds: 120,
      });
      if (leaseError || renewed !== true) {
        leaseState.lost = true;
        leaseState.controller.abort(new Error("EXECUTION_LEASE_LOST"));
        throw new Error("EXECUTION_LEASE_LOST");
      }
      const mapping = getWorkerOperationMapping({ nodeId, operationId, kind });
      if (!mapping) throw new Error("WORKER_OPERATION_MAPPING_MISSING");
      if (!mapping.provider) return;
      const { data, error } = await db.from("workspace_provider_operation_approvals")
        .select("decision")
        .eq("workspace_id", workspaceId)
        .eq("provider", mapping.provider)
        .eq("node_id", mapping.nodeId)
        .eq("operation_id", mapping.operationId)
        .order("decided_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error("WORKSPACE_OPERATION_APPROVAL_LOOKUP_FAILED");
      if (!data || data.decision !== "approved") throw new Error("WORKSPACE_PROVIDER_OPERATION_NOT_APPROVED");
    },
    rateLimit: { async consume(args) {
      const { data, error } = await db.rpc("consume_execution_rate_limit", {
        p_workspace_id: workspaceId, p_key: args.key, p_limit: args.limit, p_window_ms: args.windowMs,
      });
      if (error || !isRecord(data)) throw new Error("RATE_LIMIT_BACKEND_UNAVAILABLE");
      if (typeof data.allowed !== "boolean" || typeof data.remaining !== "number" ||
          !Number.isInteger(data.remaining) || data.remaining < 0 || data.remaining > args.limit ||
          typeof data.retryAfterMs !== "number" || !Number.isInteger(data.retryAfterMs) ||
          data.retryAfterMs < 0 || data.retryAfterMs > args.windowMs) {
        throw new Error("RATE_LIMIT_BACKEND_INVALID_RESPONSE");
      }
      return { allowed: data.allowed, remaining: data.remaining, retryAfterMs: data.retryAfterMs };
    } },
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
  const { error: pendingDispatchError } = await db.rpc("dispatch_pending_execution_error_events", { p_limit: 25 });
  if (pendingDispatchError) {
    console.warn("Aivanta worker could not dispatch pending workflow error events.");
  }
  const { data, error } = await db.rpc("claim_execution_jobs", {
    p_worker_id: workerId, p_limit: 1, p_lease_seconds: 120,
  });
  if (error || !Array.isArray(data)) {
    console.error("Aivanta worker could not claim jobs.");
    throw new Error("WORKER_CLAIM_FAILED");
  }

  let succeeded = 0, retried = 0, deadLettered = 0, leaseLost = 0, cancelled = 0;
  for (const job of data as Job[]) {
    let outcome = "EXECUTION_FAILED";
    const workflowErrorEvent: { current: { code: string; message: string; stepId: string } | null } = { current: null };
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    let heartbeatInFlight = false;
    const leaseState = { lost: false, cancelled: false, controller: new AbortController() };
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
              leaseState.lost = true;
              leaseState.controller.abort(new Error("EXECUTION_LEASE_LOST"));
              console.warn("Aivanta worker heartbeat was not renewed; provider execution will stop.", { jobId: job.id });
              return;
            }
            const { data: cancellation, error: cancellationError } = await db.from("execution_jobs")
              .select("cancel_requested_at").eq("id", job.id).eq("lease_token", job.lease_token).maybeSingle();
            if (cancellationError) throw new Error("EXECUTION_LEASE_CHECK_FAILED");
            if (cancellation?.cancel_requested_at) {
              leaseState.cancelled = true;
              leaseState.controller.abort(new Error("EXECUTION_CANCELLED"));
            }
          } catch {
            leaseState.lost = true;
            leaseState.controller.abort(new Error("EXECUTION_LEASE_LOST"));
            console.warn("Aivanta worker heartbeat failed; provider execution will stop.", { jobId: job.id });
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
      let executionSecrets: string[] = [];
      if (definition.format === "aivanta-registry-v1") {
        const validated = validateRegisteredSteps(definition.steps);
        if (!validated.steps) throw new Error("INVALID_REGISTRY_WORKFLOW_DEFINITION");
        let steps: RegisteredWorkflowStep[] = validated.steps;
        if (job.execution_mode === "live") {
          const livePolicyError = validateDurableLiveSteps(steps);
          if (livePolicyError) throw new Error(livePolicyError);
        }
        const source = job.payload?.source;
        if (source === "webhook" && (steps[0]?.kind !== "trigger" || steps[0]?.nodeId !== "webhooks" || steps[0]?.operationId !== "receive_event")) {
          throw new Error("INVALID_WEBHOOK_TRIGGER_DEFINITION");
        }
        if (source === "schedule" && (steps[0]?.kind !== "trigger" || steps[0]?.nodeId !== "schedule" || steps[0]?.operationId !== "scheduled")) {
          throw new Error("INVALID_SCHEDULE_TRIGGER_DEFINITION");
        }
        if (source === "error_trigger" && (steps[0]?.kind !== "trigger" || steps[0]?.nodeId !== "error_trigger" || steps[0]?.operationId !== "capture")) {
          throw new Error("INVALID_ERROR_TRIGGER_DEFINITION");
        }
        if (isRecord(job.payload?.input) && (source === "schedule" || source === "error_trigger" || source === "webhook" || (job.execution_mode === "live" && steps[0]?.nodeId === "manual"))) {
          steps = steps.map((step, index) => index === 0
            ? { ...step, input: { ...(isRecord(step.input) ? step.input : {}), ...(job.payload.input as Record<string, unknown>) } }
            : step);
        }
        const requiredProviders = new Set(steps.map(providerForStep).filter((value): value is string => Boolean(value) && value !== "rss_feed"));
        const credentials = job.execution_mode === "live"
          ? await workspaceCredentials(db, job.workspace_id, requiredProviders)
          : {};
        executionSecrets = knownCredentialValues(credentials);
        const context = executionContext(credentials, job.payload?.webhookVerified === true, db, job.workspace_id, job, leaseState);
        const { data: savedCheckpoints, error: checkpointReadError } = await db.from("execution_checkpoints")
          .select("step_id,status,output").eq("job_id", job.id).eq("status", "succeeded");
        if (checkpointReadError || !Array.isArray(savedCheckpoints)) throw new Error("CHECKPOINT_READ_FAILED");
        const workflowStepIds = new Set(steps.map((step) => step.id));
        const resumableIterationIds = new Set<string>();
        for (const step of steps) {
          if (!step.loop) continue;
          for (let index = 1; index <= Math.min(100, step.loop.maxIterations ?? 100); index++) {
            resumableIterationIds.add(step.id + "__loop_" + index);
          }
        }
        const initialOutputs: Record<string, unknown> = {};
        const completedStepIds: string[] = [];
        for (const checkpoint of savedCheckpoints as Array<{ step_id: string; output: unknown }>) {
          if (workflowStepIds.has(checkpoint.step_id) || resumableIterationIds.has(checkpoint.step_id)) {
            initialOutputs[checkpoint.step_id] = isRecord(checkpoint.output) && Array.isArray(checkpoint.output.__aivantaArray)
              ? checkpoint.output.__aivantaArray : checkpoint.output;
            completedStepIds.push(checkpoint.step_id);
          }
        }
        // Keep raw webhook data in the server-only job payload for wait/resume.
        // Persist only stable event metadata and a payload hash in checkpoints.
        if (source === "webhook" && steps[0]?.nodeId === "webhooks" && isRecord(job.payload?.input)) {
          initialOutputs[steps[0].id] = job.payload.input;
        }
        const registryResult = await executeRegisteredWorkflow({
          steps, context, dryRun: job.execution_mode !== "live", initialOutputs, completedStepIds,
          onWorkflowError: async (event) => {
            workflowErrorEvent.current = event;
            // Persist and enqueue subscribers in one database transaction. A
            // failure rolls back both, allowing the durable job retry to retry
            // delivery without losing an event between two RPC calls.
            if (job.execution_mode === "live" && source !== "error_trigger") {
              const { error: eventError } = await db.rpc("record_and_dispatch_execution_error_event", {
                p_job_id: job.id, p_lease_token: job.lease_token, p_step_id: event.stepId,
                p_error_code: event.code, p_safe_message: event.code, p_attempt: job.attempts,
              });
              if (eventError) throw new Error("ERROR_TRIGGER_DISPATCH_FAILED");
            } else {
              const { error: eventError } = await db.rpc("record_execution_error_event", {
                p_job_id: job.id, p_lease_token: job.lease_token, p_step_id: event.stepId,
                p_error_code: event.code, p_safe_message: event.code, p_attempt: job.attempts,
              });
              if (eventError) throw new Error("ERROR_EVENT_PERSISTENCE_FAILED");
            }
          },
          ...(job.execution_mode === "live" ? {
            onStepStart: async (step, position) => persistCheckpoint(db, job, step, position, "started"),
            onStepComplete: async (step, position, completed) => persistCheckpoint(
              db, job, step, position, completed.status === "succeeded" ? "succeeded" : "skipped",
              step.nodeId === "webhooks" ? safeWebhookTriggerOutput(job) : boundedOutput(completed.output, executionSecrets),
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
            output: steps[index]?.nodeId === "webhooks" ? safeWebhookTriggerOutput(job) : step.output,
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
              status: step.status, message: String(redactSensitiveData(step.message, executionSecrets)),
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
            executionSecrets = knownCredentialValues(credentials);
            const registrySteps: RegisteredWorkflowStep[] = [
              { id: trigger.id, nodeId: "manual", operationId: "start", kind: "trigger", input },
              {
                id: emailAction.id, nodeId: "email", operationId: "send_email", kind: "action",
                input: { to: recipient, subject: "Aivanta workflow message", text: message },
              },
            ];
            const liveResult = await executeRegisteredWorkflow({
              steps: registrySteps,
              context: executionContext(credentials, false, db, job.workspace_id, job, leaseState),
              dryRun: false,
              onStepStart: async (step, position) => {
                await persistCheckpoint(db, job, step, position, "started");
                preCheckpointed.add(step.id);
              },
              onStepComplete: async (step, position, completed) => {
                await persistCheckpoint(db, job, step, position, "succeeded", boundedOutput(completed.output, executionSecrets));
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
                  status: "skipped", message: String(redactSensitiveData(step.message, executionSecrets)),
                };
                if (sendFailed) return {
                  stepId: step.stepId, position: step.position, type: step.type, title: step.title,
                  status: "failed", message: String(redactSensitiveData(sendFailed, executionSecrets)),
                };
                return {
                  stepId: step.stepId, position: step.position, type: step.type, title: step.title,
                  status: "succeeded", message: "Resend accepted the workflow email.", output: sentOutput,
                };
              }
              return {
                stepId: step.stepId, position: step.position, type: step.type, title: step.title,
                status: step.status === "skipped" ? "skipped" : "succeeded",
                message: String(redactSensitiveData(step.message, executionSecrets)),
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
          await persistCheckpoint(db, job, registryStep, step.position, checkpointStatus, { message: String(redactSensitiveData(step.message, executionSecrets)) });
        } else if (!registryStep && !(job.execution_mode === "live" && step.status === "succeeded" && preCheckpointed.has(step.stepId))) {
          const { error: checkpointError } = await db.rpc("checkpoint_execution_step", {
            p_job_id: job.id, p_lease_token: job.lease_token,
            p_step_id: step.stepId, p_position: step.position,
            p_status: step.status === "skipped" ? "skipped" : step.status === "failed" ? "failed" : "succeeded",
            p_input: {}, p_output: { message: String(redactSensitiveData(step.message, executionSecrets)) },
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
          message: String(redactSensitiveData(step.message, executionSecrets)),
          ...(live && step.output !== undefined ? { output: boundedOutput(step.output, executionSecrets) } : {}),
        },
      }));
      const { error: stepsError } = await db.from("workflow_run_steps").upsert(stepRows, { onConflict: "run_id,step_id" });
      if (stepsError) throw new Error("RUN_STEP_PERSISTENCE_FAILED");

      if (result.status !== "succeeded") throw new Error("WORKFLOW_STEP_FAILED");

      const { data: finished, error: finishError } = await db.rpc("finish_execution_job", {
        p_job_id: job.id, p_lease_token: job.lease_token, p_succeeded: true, p_error_code: null,
      });
      if (finishError) { leaseLost++; continue; }
      if (finished === "cancelled") { cancelled++; continue; }
      if (finished !== "succeeded") { leaseLost++; continue; }
      succeeded++;
    } catch (error) {
      outcome = error instanceof Error && /^[A-Z0-9_]{1,64}$/.test(error.message) ? error.message : "EXECUTION_FAILED";
      if (outcome === "EXECUTION_CANCELLED") {
        const { data: cancelledResult, error: cancelError } = await db.rpc("finish_cancelled_execution_job", {
          p_job_id: job.id, p_lease_token: job.lease_token,
        });
        if (cancelError || cancelledResult !== true) leaseLost++;
        else cancelled++;
      } else {
        const { data: finished, error: finishError } = await db.rpc("finish_execution_job", {
          p_job_id: job.id, p_lease_token: job.lease_token, p_succeeded: false,
          p_error_code: workflowErrorEvent.current?.code ?? outcome,
          p_error_step_id: workflowErrorEvent.current?.stepId ?? null,
          p_error_message: workflowErrorEvent.current?.message ?? outcome,
        });
        if (finishError || finished === "lease_lost") leaseLost++;
        else if (finished === "dead_letter") deadLettered++;
        else if (finished === "retry_wait") retried++;
      }
      console.error("Aivanta execution job failed.", { jobId: job.id, errorCode: outcome });
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    }
  }
  return { claimed: data.length, succeeded, retried, deadLettered, leaseLost, cancelled };
}
