import "server-only";
import { createHash } from "node:crypto";
import { decryptWorkspaceCredentials } from "@/lib/integrations/workspace-credentials";
import { createFollowupRows, createRealEstateServiceClient } from "@/lib/real-estate/server";
import { scoreRealEstateLead, type RealEstateLeadInput } from "@/lib/real-estate/lead-scoring";
import { findOperation } from "@/nodes/registry";
import { getWorkerOperationMapping } from "@/lib/workflows/worker-operation-map";
import { isProviderLiveEnabled } from "@/lib/workflows/provider-live-gates";
import type { NodeContext } from "@/nodes/types";
import {
  getPlaybookPolicy, isPlaybookActionOnSelectedBranch, loadPlaybookRuntime,
  markPlaybookDecisionExecuted, pausePlaybookLead, requestOrReadPlaybookDecision,
} from "@/lib/playbooks/runtime";
import { replayPlaybookAgainstLead } from "@/lib/playbooks/replay";

type ServiceClient = ReturnType<typeof createRealEstateServiceClient>;
type PipelineClaim = { lead_id: string; workspace_id: string; lease_token: string };
type LeadRow = {
  id: string;
  workspace_id: string;
  workflow_id: string | null;
  playbook_version: number | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  source: string;
  transaction_type: NonNullable<RealEstateLeadInput["transactionType"]>;
  property_type: NonNullable<RealEstateLeadInput["propertyType"]>;
  preferred_location: string | null;
  budget_min: number | string | null;
  budget_max: number | string | null;
  currency: string | null;
  timeframe: NonNullable<RealEstateLeadInput["timeframe"]>;
  readiness: NonNullable<RealEstateLeadInput["readiness"]>;
  main_concern: string | null;
  raw_enquiry: Record<string, unknown> | null;
  lead_score: number | string | null;
  lead_temperature: string;
  qualification: unknown;
  qualification_status: string;
  qualification_summary: string | null;
  suggested_reply: string | null;
  consent_to_contact: boolean;
  consent_text: string | null;
  consent_at: string | null;
  contact_preference: string;
  created_at: string;
  pipeline_attempt_count: number | string;
  agent_notification_status: string;
  agent_notification_accepted_recipient_hashes: unknown;
  agent_notified_at: string | null;
};
type Qualification = {
  transactionType: "buy" | "rent" | "invest" | "sell" | "unknown";
  propertyType: "apartment" | "house" | "land" | "commercial" | "other" | "unknown";
  location: string | null;
  budget: string | null;
  budgetMin: number | null;
  budgetMax: number | null;
  currency: string | null;
  timeframe: "urgent" | "within_30_days" | "one_to_three_months" | "over_three_months" | "unknown";
  readiness: "cash_ready" | "pre_approved" | "financing_needed" | "researching" | "unknown";
  temperature: "hot" | "warm" | "cold";
  reason: string;
  mainConcern: string | null;
  missingInformation: string[];
  suggestedReply: string;
  summary: string;
  confidence?: number;
  followupMessages: Array<{ subject: string; message: string }>;
  inputTokens?: number;
  outputTokens?: number;
};

type CredentialResult =
  | { ok: true; credentials: Record<string, string> }
  | { ok: false; code: string };

function safeErrorCode(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  return /^[A-Z0-9_]{1,80}$/.test(message) ? message : fallback;
}

function makeNodeContext(credentials: Record<string, Record<string, string>>): NodeContext {
  return {
    credentials,
    previousOutputs: {},
    logger: {
      info(message, meta) { console.info("[real-estate-pipeline]", message, meta ?? {}); },
      error(message, meta) { console.error("[real-estate-pipeline]", message, meta ?? {}); },
    },
    http: {
      async request(args) {
        const retries = Math.min(1, Math.max(0, args.retries ?? 0));
        let lastError: unknown;
        for (let attempt = 0; attempt <= retries; attempt++) {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), Math.min(30000, Math.max(1000, args.timeoutMs ?? 15000)));
          try {
            const response = await fetch(args.url, {
              method: args.method,
              headers: args.headers,
              body: args.body === undefined ? undefined : JSON.stringify(args.body),
              signal: controller.signal,
              redirect: "error",
              cache: "no-store",
            });
            const raw = await response.text();
            let body: unknown;
            try { body = raw ? JSON.parse(raw) : {}; } catch { body = raw; }
            if ((response.status === 429 || response.status >= 500) && attempt < retries) {
              await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
              continue;
            }
            return { status: response.status, body };
          } catch (error) {
            lastError = error;
            if (attempt < retries) {
              await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
              continue;
            }
          } finally {
            clearTimeout(timer);
          }
        }
        throw lastError ?? new Error("PROVIDER_NETWORK_ERROR");
      },
    },
  };
}

async function approvedCredentials(
  db: ServiceClient,
  workspaceId: string,
  provider: string,
  nodeId: string,
  operationId: string,
  selectedConnectionId?: string,
  requireSelectedConnection = false,
): Promise<CredentialResult> {
  const mapping = getWorkerOperationMapping({ kind: "action", nodeId, operationId });
  if (!mapping || mapping.provider !== provider) return { ok: false, code: "PROVIDER_OPERATION_NOT_REGISTERED" };
  if (requireSelectedConnection && !selectedConnectionId) {
    return { ok: false, code: "WORKSPACE_CONNECTION_SELECTION_REQUIRED" };
  }

  let integrationQuery = db.from("workspace_integrations")
    .select("id,status,last_test_status")
    .eq("workspace_id", workspaceId)
    .eq("provider", provider);
  if (selectedConnectionId) integrationQuery = integrationQuery.eq("id", selectedConnectionId);

  const [connectionResult, approvalResult] = await Promise.all([
    integrationQuery.order("created_at", { ascending: true }).limit(2),
    db.from("workspace_provider_operation_approvals")
      .select("decision")
      .eq("workspace_id", workspaceId)
      .eq("provider", provider)
      .eq("node_id", nodeId)
      .eq("operation_id", operationId)
      .order("decided_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const integrations = connectionResult.data;
  const integrationError = connectionResult.error;
  const approval = approvalResult.data;
  const approvalError = approvalResult.error;
  if (integrationError || approvalError) return { ok: false, code: "PROVIDER_READINESS_LOOKUP_FAILED" };
  if (!integrations?.length) {
    return { ok: false, code: provider.toUpperCase() + "_CONNECTION_NOT_VERIFIED" };
  }
  if (integrations.length > 1) return { ok: false, code: "WORKSPACE_CONNECTION_SELECTION_REQUIRED" };
  const integration = integrations[0];
  if (integration.status !== "connected" || integration.last_test_status !== "passed") {
    return { ok: false, code: provider.toUpperCase() + "_CONNECTION_NOT_VERIFIED" };
  }
  if (approval?.decision !== "approved") return { ok: false, code: provider.toUpperCase() + "_OPERATION_NOT_APPROVED" };

  const { data: secret, error: secretError } = await db.from("workspace_integration_secrets")
    .select("encrypted_credentials,encryption_version")
    .eq("integration_id", integration.id)
    .maybeSingle();
  if (secretError || !secret || !["v1", "v2"].includes(secret.encryption_version)) {
    return { ok: false, code: provider.toUpperCase() + "_CREDENTIALS_UNAVAILABLE" };
  }
  try {
    const associatedData = secret.encryption_version === "v2"
      ? workspaceId + ":" + provider + ":" + integration.id
      : workspaceId + ":" + provider;
    const decoded = decryptWorkspaceCredentials(
      secret.encrypted_credentials,
      undefined,
      associatedData,
    );
    const credentials = (decoded as Record<string, Record<string, string>>)[provider];
    if (!credentials || Object.keys(credentials).length === 0) {
      return { ok: false, code: provider.toUpperCase() + "_CREDENTIALS_INCOMPLETE" };
    }
    return { ok: true, credentials };
  } catch {
    return { ok: false, code: provider.toUpperCase() + "_CREDENTIALS_DECRYPT_FAILED" };
  }
}

async function updateClaim(
  db: ServiceClient,
  claim: PipelineClaim,
  updates: Record<string, unknown>,
) {
  const { data, error } = await db.from("real_estate_leads")
    .update(updates)
    .eq("id", claim.lead_id)
    .eq("workspace_id", claim.workspace_id)
    .eq("pipeline_lease_token", claim.lease_token)
    .select("id")
    .maybeSingle();
  if (error || !data) throw new Error("PIPELINE_LEASE_LOST");
}

async function retryClaim(
  db: ServiceClient,
  claim: PipelineClaim,
  lead: Pick<LeadRow, "pipeline_attempt_count">,
  stage: "qualification" | "notification" | "pipeline",
  code: string,
  blocked: boolean,
) {
  const attempt = Math.max(1, Number(lead.pipeline_attempt_count) || 1);
  const delayMs = blocked
    ? 15 * 60 * 1000
    : Math.min(6 * 60 * 60 * 1000, 5 * 60 * 1000 * (2 ** Math.min(6, attempt - 1)));
  const updates: Record<string, unknown> = {
    pipeline_status: blocked ? "blocked" : "failed",
    pipeline_next_attempt_at: new Date(Date.now() + delayMs).toISOString(),
    pipeline_last_error_code: code,
    pipeline_lease_token: null,
    pipeline_lease_until: null,
  };
  if (stage === "qualification") {
    updates.qualification_status = blocked ? "blocked" : "failed";
    updates.qualification_error_code = code;
  } else if (stage === "notification") {
    updates.agent_notification_status = blocked ? "blocked" : "failed";
    updates.agent_notification_error_code = code;
  }
  await updateClaim(db, claim, updates);
}

function qualificationInput(lead: LeadRow) {
  const rawMessage = lead.raw_enquiry && typeof lead.raw_enquiry === "object"
    ? String(lead.raw_enquiry.message ?? "")
    : "";
  const sanitizedMessage = rawMessage
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted email]")
    .replace(/\b\+?\d[\d\s().-]{7,}\d\b/g, "[redacted phone]")
    .replaceAll(lead.full_name, "[redacted name]");
  return JSON.stringify({
    transactionType: lead.transaction_type,
    propertyType: lead.property_type,
    preferredLocation: lead.preferred_location,
    budgetMin: lead.budget_min,
    budgetMax: lead.budget_max,
    currency: lead.currency,
    timeframe: lead.timeframe,
    readiness: lead.readiness,
    mainConcern: lead.main_concern,
    source: lead.source,
    enquiryMessage: sanitizedMessage,
  });
}
function mergeQualification(lead: LeadRow, qualification: Qualification) {
  const transactionType = lead.transaction_type === "unknown" ? qualification.transactionType : lead.transaction_type;
  const propertyType = lead.property_type === "unknown" ? qualification.propertyType : lead.property_type;
  const preferredLocation = lead.preferred_location || qualification.location;
  const budgetMin = lead.budget_min === null && Number.isFinite(qualification.budgetMin) ? qualification.budgetMin : lead.budget_min;
  const budgetMax = lead.budget_max === null && Number.isFinite(qualification.budgetMax) ? qualification.budgetMax : lead.budget_max;
  const currency = lead.currency || qualification.currency || "USD";
  const timeframe = lead.timeframe === "unknown" ? qualification.timeframe : lead.timeframe;
  const readiness = lead.readiness === "unknown" ? qualification.readiness : lead.readiness;
  const mainConcern = lead.main_concern || qualification.mainConcern;
  const score = scoreRealEstateLead({
    transactionType,
    propertyType,
    preferredLocation,
    budgetMin: budgetMin === null ? null : Number(budgetMin),
    budgetMax: budgetMax === null ? null : Number(budgetMax),
    timeframe,
    readiness,
    email: lead.email,
    phone: lead.phone,
  });
  return {
    transaction_type: transactionType,
    property_type: propertyType,
    preferred_location: preferredLocation,
    budget_min: budgetMin,
    budget_max: budgetMax,
    currency,
    timeframe,
    readiness,
    main_concern: mainConcern,
    lead_score: score.score,
    lead_temperature: score.temperature,
    score_factors: score.factors,
    qualification: qualification as unknown as Record<string, unknown>,
    qualification_summary: qualification.summary,
    suggested_reply: qualification.suggestedReply,
    qualification_status: "succeeded",
    qualification_error_code: null,
    qualified_at: new Date().toISOString(),
  };
}

async function ensureQualificationActivity(db: ServiceClient, lead: LeadRow, workspaceId: string, score: number) {
  const { data: existing, error: lookupError } = await db.from("real_estate_lead_activities")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("lead_id", lead.id)
    .eq("activity_type", "lead.ai_qualified")
    .limit(1)
    .maybeSingle();
  if (lookupError) throw new Error("PIPELINE_ACTIVITY_LOOKUP_FAILED");
  if (existing) return;
  const { error } = await db.from("real_estate_lead_activities").insert({
    workspace_id: workspaceId,
    lead_id: lead.id,
    actor_user_id: null,
    activity_type: "lead.ai_qualified",
    details: { score, source: "gemini", numericScore: "deterministic" },
  });
  if (error) throw new Error("PIPELINE_ACTIVITY_WRITE_FAILED");
}

async function ensureFollowupDrafts(db: ServiceClient, lead: LeadRow, qualification: Qualification) {
  if (!lead.consent_to_contact || !lead.consent_at || !lead.consent_text || lead.contact_preference !== "email" || !lead.email) return;
  const rows = createFollowupRows(lead as Parameters<typeof createFollowupRows>[0], new Date(lead.created_at))
    .map((row, index) => ({
      ...row,
      subject: qualification.followupMessages[index].subject,
      message: qualification.followupMessages[index].message,
    }));
  const { error: insertError } = await db.from("real_estate_followups")
    .upsert(rows, { onConflict: "lead_id,sequence", ignoreDuplicates: true });
  if (insertError) throw new Error("FOLLOWUP_QUEUE_WRITE_FAILED");

  // Replace fallback drafts only while a message is still pending. Sent messages
  // and active worker leases are never rewritten.
  for (const row of rows) {
    const { error } = await db.from("real_estate_followups")
      .update({ subject: row.subject, message: row.message })
      .eq("workspace_id", lead.workspace_id)
      .eq("lead_id", lead.id)
      .eq("sequence", row.sequence)
      .eq("status", "pending");
    if (error) throw new Error("FOLLOWUP_DRAFT_UPDATE_FAILED");
  }
}

async function workspaceNotificationRecipients(db: ServiceClient, workspaceId: string) {
  const { data, error } = await db.from("real_estate_notification_recipients")
    .select("email")
    .eq("workspace_id", workspaceId)
    .eq("active", true)
    .order("created_at", { ascending: true })
    .limit(25);
  if (error) throw new Error("AGENCY_NOTIFICATION_RECIPIENT_LOOKUP_FAILED");
  const recipients = (data ?? [])
    .map((row) => typeof row.email === "string" ? row.email.trim().toLowerCase() : "")
    .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
  return [...new Set(recipients)].slice(0, 25);
}

async function sendAgentNotifications(
  db: ServiceClient,
  claim: PipelineClaim,
  lead: LeadRow,
  qualification: Qualification,
  selectedConnectionId?: string,
  requireSelectedConnection = false,
) {
  const configured = await approvedCredentials(
    db, claim.workspace_id, "resend", "email", "send_email",
    selectedConnectionId, requireSelectedConnection,
  );
  if (!configured.ok) return { ok: false as const, blocked: true, code: configured.code };
  const recipients = await workspaceNotificationRecipients(db, claim.workspace_id);
  if (!recipients.length) return { ok: false as const, blocked: true, code: "AGENCY_NOTIFICATION_RECIPIENT_NOT_APPROVED" };

  const operation = findOperation("email", "send_email", "action");
  if (!operation) return { ok: false as const, blocked: true, code: "RESEND_OPERATION_NOT_REGISTERED" };
  const acceptedHashes = new Set(
    Array.isArray(lead.agent_notification_accepted_recipient_hashes)
      ? lead.agent_notification_accepted_recipient_hashes.filter((value: unknown): value is string => typeof value === "string")
      : [],
  );
  const context = makeNodeContext({ resend: configured.credentials });
  const score = Number(lead.lead_score) || 0;
  const dashboardUrl = process.env.NEXT_PUBLIC_APP_URL
    ? process.env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "") + "/dashboard/real-estate"
    : "Open the Rexnora dashboard and select Real Estate.";

  for (const recipient of recipients) {
    const hash = createHash("sha256").update(recipient, "utf8").digest("hex");
    if (acceptedHashes.has(hash)) continue;
    const text = [
      "A new real-estate enquiry needs your attention.",
      "",
      "Customer: " + lead.full_name,
      "Email: " + (lead.email ?? "Not provided"),
      "Phone: " + (lead.phone ?? "Not provided"),
      "Intent: " + lead.transaction_type,
      "Property: " + lead.property_type,
      "Location: " + (lead.preferred_location ?? "Not provided"),
      "Budget: " + (lead.budget_min ?? "Not provided") + " – " + (lead.budget_max ?? "Not provided") + " " + (lead.currency ?? ""),
      "Timeline: " + lead.timeframe,
      "Lead score: " + score + "/100 (" + lead.lead_temperature + ")",
      "",
      "AI qualification: " + qualification.summary,
      "Suggested first response: " + qualification.suggestedReply,
      "Main concern: " + (qualification.mainConcern ?? "Not identified"),
      "Missing information: " + (qualification.missingInformation.join(", ") || "None identified"),
      "",
      "Next action: review the enquiry, assign an agent and contact the customer in line with the recorded consent.",
      dashboardUrl,
    ].join("\n");
    await operation.run(context, {
      to: recipient,
      subject: "New property enquiry · " + lead.full_name + " · " + score + "/100",
      text,
      idempotencyKey: "real-estate-agent-alert:" + lead.id + ":" + hash.slice(0, 24),
    });
    acceptedHashes.add(hash);
    await updateClaim(db, claim, {
      agent_notification_accepted_recipient_hashes: [...acceptedHashes],
    });
  }
  return { ok: true as const };
}


async function ensureBackOfficeTask(db: ServiceClient, lead: LeadRow) {
  const idempotencyKey = "real-estate-new-enquiry-review:" + lead.id;
  const dueAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const { error } = await db.from("real_estate_tasks").upsert({
    workspace_id: lead.workspace_id,
    lead_id: lead.id,
    task_type: "new_enquiry_review",
    title: "Review new property enquiry",
    description: "Review the saved Gemini qualification, confirm ownership and record the next agency action.",
    priority: lead.lead_temperature === "hot" ? "urgent" : lead.lead_temperature === "warm" ? "high" : "normal",
    due_at: dueAt,
    idempotency_key: idempotencyKey,
  }, { onConflict: "workspace_id,idempotency_key", ignoreDuplicates: true });
  if (error) throw new Error("REAL_ESTATE_BACK_OFFICE_TASK_WRITE_FAILED");

  const { data: existing, error: lookupError } = await db.from("real_estate_lead_activities")
    .select("id").eq("workspace_id", lead.workspace_id).eq("lead_id", lead.id)
    .eq("activity_type", "lead.back_office_task_created")
    .contains("details", { idempotencyKey }).limit(1).maybeSingle();
  if (lookupError) throw new Error("REAL_ESTATE_BACK_OFFICE_TASK_AUDIT_LOOKUP_FAILED");
  if (!existing) {
    const { error: eventError } = await db.from("real_estate_lead_activities").insert({
      workspace_id: lead.workspace_id,
      lead_id: lead.id,
      actor_user_id: null,
      activity_type: "lead.back_office_task_created",
      details: { idempotencyKey, taskType: "new_enquiry_review", priority: lead.lead_temperature },
    });
    if (eventError) throw new Error("REAL_ESTATE_BACK_OFFICE_TASK_AUDIT_WRITE_FAILED");
  }
}

function recordDetails(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function resolveTemplateParameter(value: string, lead: LeadRow): string {
  const fields: Record<string, unknown> = {
    full_name: lead.full_name,
    email: lead.email,
    phone: lead.phone,
    preferred_location: lead.preferred_location,
    budget_min: lead.budget_min,
    budget_max: lead.budget_max,
    currency: lead.currency,
    transaction_type: lead.transaction_type,
    property_type: lead.property_type,
    timeframe: lead.timeframe,
    lead_score: lead.lead_score,
    lead_temperature: lead.lead_temperature,
    qualification_summary: lead.qualification_summary,
  };
  return value.replace(/\{\{\s*lead\.([a-z_]+)\s*\}\}/g, (_match, key: string) => {
    const field = fields[key];
    return field === null || field === undefined ? "" : String(field);
  }).slice(0, 1024);
}

type ExternalActionResult = { state: "completed" | "skipped" | "paused" | "blocked" | "retry"; code?: string };

async function sendWhatsAppTemplate(
  db: ServiceClient,
  claim: PipelineClaim,
  lead: LeadRow,
  runtime: Awaited<ReturnType<typeof loadPlaybookRuntime>>,
  ruleResults: Array<{ nodeId: string; route: string | null }>,
): Promise<ExternalActionResult> {
  if (runtime.mode !== "playbook") return { state: "skipped" };
  const policy = getPlaybookPolicy(runtime, "whatsapp_business", "send_template");
  if (!policy || policy.permission === "never" || !isPlaybookActionOnSelectedBranch(runtime, policy, ruleResults)) {
    return { state: "skipped" };
  }

  // WhatsApp is a customer communication channel: require channel-specific,
  // timestamped consent and a valid E.164 destination before touching providers.
  if (!lead.consent_to_contact || !lead.consent_at || !lead.consent_text ||
      !/whatsapp/i.test(lead.consent_text) || lead.contact_preference !== "whatsapp") {
    await db.from("real_estate_lead_activities").insert({
      workspace_id: claim.workspace_id, lead_id: lead.id, actor_user_id: null,
      activity_type: "lead.whatsapp_action_skipped",
      details: { reason: "CHANNEL_SPECIFIC_CONSENT_NOT_RECORDED", channel: "whatsapp" },
    });
    return { state: "skipped" };
  }
  if (!lead.phone || !/^\+[1-9]\d{7,14}$/.test(lead.phone)) {
    await db.from("real_estate_lead_activities").insert({
      workspace_id: claim.workspace_id, lead_id: lead.id, actor_user_id: null,
      activity_type: "lead.whatsapp_action_skipped",
      details: { reason: "WHATSAPP_E164_PHONE_REQUIRED", channel: "whatsapp" },
    });
    return { state: "skipped" };
  }

  if (!isProviderLiveEnabled("whatsapp_business", process.env.AIVANTA_LIVE_INTEGRATIONS)) {
    return { state: "blocked", code: "WHATSAPP_BUSINESS_LIVE_GATE_DISABLED" };
  }
  const step = runtime.steps?.find((candidate) => candidate.id === policy.stepId);
  if (!step?.connectionId) return { state: "blocked", code: "WORKSPACE_CONNECTION_SELECTION_REQUIRED" };

  const gate = await requestOrReadPlaybookDecision({
    db, lead, runtime, type: "action_approval", policy,
    reason: "The Playbook requires approval before sending this approved WhatsApp template.",
    leaseToken: claim.lease_token,
  });
  if (gate.state === "pending") return { state: "paused", code: "WHATSAPP_ACTION_APPROVAL_REQUIRED" };
  if (gate.state === "denied") return { state: "blocked", code: "WHATSAPP_ACTION_APPROVAL_REJECTED" };

  const configured = await approvedCredentials(
    db, claim.workspace_id, "whatsapp_business", "whatsapp_business", "send_template",
    step.connectionId, true,
  );
  if (!configured.ok) return { state: "blocked", code: configured.code };

  const { data: existing, error: lookupError } = await db.from("real_estate_channel_deliveries")
    .select("id,status,attempt_count,max_attempts,next_attempt_at,last_error_code")
    .eq("workspace_id", claim.workspace_id).eq("lead_id", lead.id)
    .eq("channel", "whatsapp").eq("sequence", 1).maybeSingle();
  if (lookupError) return { state: "blocked", code: "WHATSAPP_DELIVERY_LOOKUP_FAILED" };
  if (existing?.status === "accepted") return { state: "completed" };
  if (existing?.status === "cancelled" || existing?.status === "blocked") return { state: "blocked", code: existing.last_error_code ?? "WHATSAPP_DELIVERY_BLOCKED" };
  if (existing?.status === "unknown" || existing?.status === "sending") {
    await db.from("real_estate_lead_activities").insert({
      workspace_id: claim.workspace_id, lead_id: lead.id, actor_user_id: null,
      activity_type: "lead.whatsapp_delivery_needs_reconciliation",
      details: { deliveryId: existing.id, reason: "A previous provider request may have been accepted; automatic resend is disabled." },
    });
    return { state: "blocked", code: "WHATSAPP_DELIVERY_UNKNOWN_REQUIRES_RECONCILIATION" };
  }
  if (existing?.status === "failed") {
    if (!String(existing.last_error_code ?? "").includes("RATE_LIMITED") ||
        Number(existing.attempt_count) >= Number(existing.max_attempts) ||
        new Date(existing.next_attempt_at).getTime() > Date.now()) {
      return { state: "blocked", code: existing.last_error_code ?? "WHATSAPP_RETRY_NOT_ALLOWED" };
    }
  }

  const nextAttempt = existing ? Number(existing.attempt_count) + 1 : 1;
  if (existing) {
    const { data: claimed, error } = await db.from("real_estate_channel_deliveries")
      .update({ status: "sending", attempt_count: nextAttempt, last_attempt_at: new Date().toISOString(), last_error_code: null })
      .eq("id", existing.id).eq("workspace_id", claim.workspace_id).eq("status", "failed")
      .select("id").maybeSingle();
    if (error || !claimed) return { state: "blocked", code: "WHATSAPP_DELIVERY_RETRY_CLAIM_FAILED" };
  } else {
    const { error } = await db.from("real_estate_channel_deliveries").insert({
      workspace_id: claim.workspace_id, lead_id: lead.id, channel: "whatsapp", sequence: 1,
      status: "sending", idempotency_key: "real-estate-whatsapp:" + lead.id,
      attempt_count: 1, max_attempts: 3, last_attempt_at: new Date().toISOString(),
    });
    if (error) return { state: "blocked", code: error.code === "23505" ? "WHATSAPP_DELIVERY_ALREADY_CLAIMED" : "WHATSAPP_DELIVERY_CREATE_FAILED" };
  }

  const operation = findOperation("whatsapp_business", "send_template", "action");
  if (!operation) {
    await db.from("real_estate_channel_deliveries").update({ status: "blocked", last_error_code: "WHATSAPP_OPERATION_NOT_REGISTERED" })
      .eq("workspace_id", claim.workspace_id).eq("lead_id", lead.id).eq("channel", "whatsapp").eq("sequence", 1);
    return { state: "blocked", code: "WHATSAPP_OPERATION_NOT_REGISTERED" };
  }
  const configuredInput = recordDetails(step.input);
  const parameters = Array.isArray(configuredInput.bodyParameters)
    ? configuredInput.bodyParameters.filter((item): item is string => typeof item === "string").slice(0, 20).map((item) => resolveTemplateParameter(item, lead))
    : [];
  const input: Record<string, unknown> = { to: lead.phone, bodyParameters: parameters };
  if (typeof configuredInput.templateName === "string") input.templateName = configuredInput.templateName;
  if (typeof configuredInput.language === "string") input.language = configuredInput.language;
  try {
    const result = await operation.run(makeNodeContext({ whatsapp_business: configured.credentials }), input) as { messageId?: string };
    if (typeof result?.messageId !== "string" || !result.messageId) throw new Error("WHATSAPP_PROVIDER_MESSAGE_ID_MISSING");
    const { error } = await db.from("real_estate_channel_deliveries").update({
      status: "accepted", provider_message_id: result.messageId, accepted_at: new Date().toISOString(),
      last_error_code: null,
    }).eq("workspace_id", claim.workspace_id).eq("lead_id", lead.id).eq("channel", "whatsapp").eq("sequence", 1).eq("status", "sending");
    if (error) return { state: "blocked", code: "WHATSAPP_DELIVERY_OUTCOME_WRITE_FAILED" };
    await db.from("real_estate_lead_activities").insert({
      workspace_id: claim.workspace_id, lead_id: lead.id, actor_user_id: null,
      activity_type: "lead.whatsapp_template_accepted",
      details: { messageId: result.messageId, templateName: typeof configuredInput.templateName === "string" ? configuredInput.templateName : "workspace_default" },
    });
    await markPlaybookDecisionExecuted(db, lead, gate.decisionId);
    return { state: "completed" };
  } catch (error) {
    const code = safeErrorCode(error, "WHATSAPP_DELIVERY_UNKNOWN");
    const rateLimited = /RATE_LIMITED/.test(code);
    const definiteClientReject = /_HTTP_4\d\d/.test(code) && !/_HTTP_429/.test(code);
    const nextStatus = rateLimited ? "failed" : definiteClientReject ? "blocked" : "unknown";
    const { error: persistError } = await db.from("real_estate_channel_deliveries").update({
      status: nextStatus,
      last_error_code: code,
      next_attempt_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    }).eq("workspace_id", claim.workspace_id).eq("lead_id", lead.id).eq("channel", "whatsapp").eq("sequence", 1);
    if (persistError) return { state: "blocked", code: "WHATSAPP_DELIVERY_OUTCOME_WRITE_FAILED" };
    if (nextStatus === "unknown") {
      if (runtime.definition?.review.reviewProviderFailures) {
        const failureGate = await requestOrReadPlaybookDecision({
          db, lead, runtime, type: "provider_failure", policy,
          reason: "WhatsApp provider outcome is unknown; reconcile the Meta message before any resend. " + code,
          leaseToken: claim.lease_token,
        });
        if (failureGate.state === "pending") return { state: "paused", code: "WHATSAPP_DELIVERY_UNKNOWN_REQUIRES_RECONCILIATION" };
      }
      return { state: "blocked", code: "WHATSAPP_DELIVERY_UNKNOWN_REQUIRES_RECONCILIATION" };
    }
    return { state: "blocked", code };
  }
}

const CRM_PROVIDERS = ["pipedrive", "zoho_crm", "freshsales"] as const;
type CrmProvider = typeof CRM_PROVIDERS[number];

async function syncRealEstateCrmContact(
  db: ServiceClient,
  claim: PipelineClaim,
  lead: LeadRow,
  runtime: Awaited<ReturnType<typeof loadPlaybookRuntime>>,
  ruleResults: Array<{ nodeId: string; route: string | null }>,
): Promise<ExternalActionResult> {
  if (runtime.mode !== "playbook") return { state: "skipped" };
  const provider = CRM_PROVIDERS.find((candidate) =>
    runtime.steps?.some((step) => step.nodeId === candidate && step.operationId === "search_contacts") &&
    runtime.steps?.some((step) => step.nodeId === candidate && step.operationId === "execute")
  ) as CrmProvider | undefined;
  if (!provider) return { state: "skipped" };

  const searchStep = runtime.steps?.find((step) => step.nodeId === provider && step.operationId === "search_contacts");
  const createStep = runtime.steps?.find((step) => step.nodeId === provider && step.operationId === "execute");
  const searchPolicy = getPlaybookPolicy(runtime, provider, "search_contacts");
  const createPolicy = getPlaybookPolicy(runtime, provider, "execute");
  if (!searchStep || !createStep || !searchPolicy || !createPolicy ||
      !isPlaybookActionOnSelectedBranch(runtime, searchPolicy, ruleResults) ||
      !isPlaybookActionOnSelectedBranch(runtime, createPolicy, ruleResults)) return { state: "skipped" };

  if (!lead.consent_to_contact || !lead.consent_at || !lead.consent_text || !lead.email) {
    await db.from("real_estate_lead_activities").insert({
      workspace_id: claim.workspace_id, lead_id: lead.id, actor_user_id: null,
      activity_type: "lead.crm_sync_skipped",
      details: { provider, reason: "RECORDED_CONTACT_CONSENT_AND_EMAIL_REQUIRED" },
    });
    return { state: "skipped" };
  }
  if (!isProviderLiveEnabled(provider, process.env.AIVANTA_LIVE_INTEGRATIONS)) {
    return { state: "blocked", code: provider.toUpperCase() + "_LIVE_GATE_DISABLED" };
  }
  if (searchPolicy.permission === "never" || createPolicy.permission === "never") {
    await db.from("real_estate_lead_activities").insert({
      workspace_id: claim.workspace_id, lead_id: lead.id, actor_user_id: null,
      activity_type: "lead.crm_sync_skipped",
      details: { provider, reason: "CRM_ACTION_DISABLED_BY_PLAYBOOK_POLICY" },
    });
    return { state: "skipped" };
  }

  const selectedConnectionId = searchStep.connectionId ?? createStep.connectionId;
  if (!selectedConnectionId || (searchStep.connectionId && createStep.connectionId && searchStep.connectionId !== createStep.connectionId)) {
    return { state: "blocked", code: "WORKSPACE_CONNECTION_SELECTION_REQUIRED" };
  }
  const idempotencyKey = "real-estate-crm-contact:" + lead.id + ":" + provider;
  const { data: prior, error: priorError } = await db.from("real_estate_crm_syncs")
    .select("id,status,attempt_count,max_attempts,last_error_code,provider_contact_id")
    .eq("workspace_id", claim.workspace_id).eq("lead_id", lead.id).eq("provider", provider).maybeSingle();
  if (priorError) return { state: "blocked", code: "CRM_SYNC_LOOKUP_FAILED" };
  if (prior?.status === "created" || prior?.status === "matched") return { state: "completed" };
  if (prior?.status === "blocked") return { state: "blocked", code: prior.last_error_code ?? "CRM_SYNC_BLOCKED" };
  if (prior?.status === "failed" && Number(prior.attempt_count) >= Number(prior.max_attempts)) {
    return { state: "blocked", code: prior.last_error_code ?? "CRM_SYNC_RETRY_LIMIT_REACHED" };
  }

  const searchGate = await requestOrReadPlaybookDecision({
    db, lead, runtime, type: "action_approval", policy: searchPolicy,
    reason: "The Playbook requires approval before searching the selected CRM for this exact email.",
    leaseToken: claim.lease_token,
  });
  if (searchGate.state === "pending") return { state: "paused", code: "CRM_SEARCH_APPROVAL_REQUIRED" };
  if (searchGate.state === "denied") return { state: "blocked", code: "CRM_SEARCH_APPROVAL_REJECTED" };
  const searchCredentials = await approvedCredentials(db, claim.workspace_id, provider, provider, "search_contacts", selectedConnectionId, true);
  if (!searchCredentials.ok) return { state: "blocked", code: searchCredentials.code };
  const searchOperation = findOperation(provider, "search_contacts", "action");
  const createOperation = findOperation(provider, "execute", "action");
  if (!searchOperation || !createOperation) return { state: "blocked", code: "CRM_OPERATION_NOT_REGISTERED" };

  let matches: Array<{ contactId: string; email?: string }> = [];
  try {
    const searchResult = await searchOperation.run(
      makeNodeContext({ [provider]: searchCredentials.credentials }),
      { email: lead.email },
    ) as { contacts?: Array<{ contactId: string; email?: string }> };
    const candidates = Array.isArray(searchResult.contacts)
      ? searchResult.contacts.filter((item) => item && typeof item.contactId === "string")
      : [];
    matches = candidates.filter((item) =>
      typeof item.email === "string" && item.email.toLowerCase() === String(lead.email).toLowerCase()
    );
    if (candidates.length > matches.length) {
      await db.from("real_estate_crm_syncs").upsert({
        workspace_id: claim.workspace_id, lead_id: lead.id, provider,
        status: "unknown", idempotency_key: idempotencyKey, last_error_code: "CRM_SEARCH_RESULT_NEEDS_REVIEW",
      }, { onConflict: "workspace_id,lead_id,provider" });
      await db.from("real_estate_lead_activities").insert({
        workspace_id: claim.workspace_id, lead_id: lead.id, actor_user_id: null,
        activity_type: "lead.crm_sync_needs_review",
        details: { provider, reason: "CRM search returned records that could not be verified by exact email; automatic create is disabled." },
      });
      const review = await requestOrReadPlaybookDecision({
        db, lead, runtime, type: "provider_failure", policy: createPolicy,
        reason: "The CRM search returned a possible match without an exact verified email. Resolve the duplicate/identity check before creating another contact.",
        leaseToken: claim.lease_token,
      });
      return review.state === "pending"
        ? { state: "paused", code: "CRM_SEARCH_RESULT_NEEDS_REVIEW" }
        : { state: "blocked", code: "CRM_SEARCH_RESULT_NEEDS_REVIEW" };
    }
  } catch (error) {
    const code = safeErrorCode(error, "CRM_SEARCH_FAILED");
    if (/RATE_LIMITED|_HTTP_5\\d\\d/.test(code)) return { state: "retry", code };
    return { state: "blocked", code };
  }

  if (matches.length > 1) {
    await db.from("real_estate_crm_syncs").upsert({
      workspace_id: claim.workspace_id, lead_id: lead.id, provider,
      status: "unknown", idempotency_key: idempotencyKey, last_error_code: "CRM_DUPLICATE_EMAIL_MATCHES",
    }, { onConflict: "workspace_id,lead_id,provider" });
    await db.from("real_estate_lead_activities").insert({
      workspace_id: claim.workspace_id, lead_id: lead.id, actor_user_id: null,
      activity_type: "lead.crm_sync_needs_review",
      details: { provider, reason: "CRM_DUPLICATE_EMAIL_MATCHES", matchCount: matches.length },
    });
    return { state: "blocked", code: "CRM_DUPLICATE_EMAIL_MATCHES" };
  }

  if (matches.length === 1) {
    const { error } = await db.from("real_estate_crm_syncs").upsert({
      workspace_id: claim.workspace_id, lead_id: lead.id, provider,
      status: "matched", idempotency_key: idempotencyKey,
      provider_contact_id: matches[0].contactId, accepted_at: new Date().toISOString(), last_error_code: null,
    }, { onConflict: "workspace_id,lead_id,provider" });
    if (error) return { state: "blocked", code: "CRM_SYNC_OUTCOME_WRITE_FAILED" };
    await db.from("real_estate_lead_activities").insert({
      workspace_id: claim.workspace_id, lead_id: lead.id, actor_user_id: null,
      activity_type: "lead.crm_contact_matched",
      details: { provider, contactId: matches[0].contactId, idempotencyKey },
    });
    await markPlaybookDecisionExecuted(db, lead, searchGate.decisionId);
    return { state: "completed" };
  }

  // A prior uncertain/creating state is never blindly repeated. The exact email
  // search above is the reconciliation step; the owner must approve retry.
  if (prior && ["unknown", "creating"].includes(prior.status)) {
    const recovery = await requestOrReadPlaybookDecision({
      db, lead, runtime, type: "provider_failure", policy: createPolicy,
      reason: "The prior CRM create may have completed despite a missing response. Exact-email search found no matching contact; approve a single reconciled retry.",
      leaseToken: claim.lease_token,
    });
    if (recovery.state === "pending") return { state: "paused", code: "CRM_CREATE_RECONCILIATION_APPROVAL_REQUIRED" };
    if (recovery.state === "denied") return { state: "blocked", code: "CRM_CREATE_RECONCILIATION_REJECTED" };
  }

  const createGate = await requestOrReadPlaybookDecision({
    db, lead, runtime, type: "action_approval", policy: createPolicy,
    reason: "The Playbook requires approval before creating a new CRM contact.",
    leaseToken: claim.lease_token,
  });
  if (createGate.state === "pending") return { state: "paused", code: "CRM_CREATE_APPROVAL_REQUIRED" };
  if (createGate.state === "denied") return { state: "blocked", code: "CRM_CREATE_APPROVAL_REJECTED" };

  const createCredentials = await approvedCredentials(db, claim.workspace_id, provider, provider, "execute", selectedConnectionId, true);
  if (!createCredentials.ok) return { state: "blocked", code: createCredentials.code };
  const nameParts = lead.full_name.trim().split(/\s+/).filter(Boolean);
  const contactName = { firstName: nameParts[0] || "Lead", lastName: nameParts.slice(1).join(" ") || "Lead" };
  const createInput = provider === "freshsales"
    ? { email: lead.email, ...contactName, ...(lead.phone ? { phone: lead.phone } : {}) }
    : { email: lead.email, ...contactName, ...(lead.phone ? { phone: lead.phone } : {}) };

  const { error: ledgerError } = await db.from("real_estate_crm_syncs").upsert({
    workspace_id: claim.workspace_id, lead_id: lead.id, provider,
    status: "creating", idempotency_key: idempotencyKey,
    attempt_count: Number(prior?.attempt_count ?? 0) + 1,
    max_attempts: Number(prior?.max_attempts ?? 3), last_error_code: null,
  }, { onConflict: "workspace_id,lead_id,provider" });
  if (ledgerError) return { state: "blocked", code: "CRM_SYNC_LEDGER_CLAIM_FAILED" };

  try {
    const created = await createOperation.run(
      makeNodeContext({ [provider]: createCredentials.credentials }),
      createInput,
    ) as { contactId?: string };
    if (!created || typeof created.contactId !== "string" || !created.contactId) throw new Error("CRM_CONTACT_ID_MISSING");
    const { error } = await db.from("real_estate_crm_syncs").update({
      status: "created", provider_contact_id: created.contactId,
      accepted_at: new Date().toISOString(), last_error_code: null,
    }).eq("workspace_id", claim.workspace_id).eq("lead_id", lead.id).eq("provider", provider);
    if (error) return { state: "blocked", code: "CRM_SYNC_OUTCOME_WRITE_FAILED" };
    await db.from("real_estate_lead_activities").insert({
      workspace_id: claim.workspace_id, lead_id: lead.id, actor_user_id: null,
      activity_type: "lead.crm_contact_created",
      details: { provider, contactId: created.contactId, idempotencyKey },
    });
    await markPlaybookDecisionExecuted(db, lead, searchGate.decisionId);
    await markPlaybookDecisionExecuted(db, lead, createGate.decisionId);
    return { state: "completed" };
  } catch (error) {
    const code = safeErrorCode(error, "CRM_CREATE_OUTCOME_UNKNOWN");
    const rateLimited = /RATE_LIMITED/.test(code);
    const definiteClientReject = /_HTTP_4\\d\\d/.test(code) && !/_HTTP_429/.test(code);
    await db.from("real_estate_crm_syncs").update({
      status: rateLimited ? "failed" : definiteClientReject ? "blocked" : "unknown",
      last_error_code: code,
    }).eq("workspace_id", claim.workspace_id).eq("lead_id", lead.id).eq("provider", provider);
    if (!rateLimited && !definiteClientReject) {
      const failureGate = await requestOrReadPlaybookDecision({
        db, lead, runtime, type: "provider_failure", policy: createPolicy,
        reason: "CRM contact creation outcome needs reconciliation before another create attempt. " + code,
        leaseToken: claim.lease_token,
      });
      if (failureGate.state === "pending") return { state: "paused", code: "CRM_CREATE_OUTCOME_UNKNOWN_REQUIRES_REVIEW" };
    }
    return { state: rateLimited ? "retry" : "blocked", code };
  }
}

async function processClaim(db: ServiceClient, claim: PipelineClaim) {
  const { data: leadData, error } = await db.from("real_estate_leads")
    .select("*")
    .eq("id", claim.lead_id)
    .eq("workspace_id", claim.workspace_id)
    .eq("pipeline_lease_token", claim.lease_token)
    .maybeSingle();
  if (error || !leadData) throw new Error("PIPELINE_LEAD_LOOKUP_FAILED");
  let lead: LeadRow = leadData;
  const runtime = await loadPlaybookRuntime(db, lead);

  if (runtime.mode === "invalid") {
    await pausePlaybookLead(db, lead, claim.lease_token, runtime.reason ?? "PLAYBOOK_VERSION_INVALID");
    await db.from("real_estate_lead_activities").insert({
      workspace_id: claim.workspace_id, lead_id: lead.id, actor_user_id: null,
      activity_type: "lead.playbook_blocked",
      details: { workflowId: lead.workflow_id, workflowVersion: lead.playbook_version, reason: runtime.reason ?? "PLAYBOOK_VERSION_INVALID" },
    });
    return "blocked";
  }

  const geminiPolicy = runtime.mode === "playbook"
    ? getPlaybookPolicy(runtime, "gemini", "qualify_real_estate_lead")
    : null;
  if (runtime.mode === "playbook" && !geminiPolicy) {
    await pausePlaybookLead(db, lead, claim.lease_token, "PLAYBOOK_GEMINI_POLICY_MISSING");
    await db.from("real_estate_lead_activities").insert({
      workspace_id: claim.workspace_id, lead_id: lead.id, actor_user_id: null,
      activity_type: "lead.playbook_blocked",
      details: { workflowId: runtime.workflowId, workflowVersion: runtime.version, reason: "PLAYBOOK_GEMINI_POLICY_MISSING" },
    });
    return "blocked";
  }

  let qualification = lead.qualification_status === "succeeded"
    ? lead.qualification as Qualification
    : null;
  if (!qualification) {
    let qualificationDecisionId: string | undefined;
    if (runtime.mode === "playbook" && geminiPolicy) {
      const gate = await requestOrReadPlaybookDecision({
        db, lead, runtime, type: "action_approval", policy: geminiPolicy,
        reason: "The Playbook requires approval before Gemini qualifies this enquiry.",
        leaseToken: claim.lease_token,
      });
      if (gate.state === "pending") return "blocked";
      if (gate.state === "denied") {
        await pausePlaybookLead(db, lead, claim.lease_token, "PLAYBOOK_GEMINI_ACTION_BLOCKED");
        return "blocked";
      }
      qualificationDecisionId = gate.decisionId;
    }

    const geminiStep = runtime.mode === "playbook"
      ? runtime.steps?.find((step) => step.nodeId === "gemini" && step.operationId === "qualify_real_estate_lead")
      : undefined;
    const configured = await approvedCredentials(
      db, claim.workspace_id, "gemini", "gemini", "qualify_real_estate_lead",
      geminiStep?.connectionId, runtime.mode === "playbook",
    );
    if (!configured.ok) {
      if (runtime.mode === "playbook" && runtime.definition?.review.reviewProviderFailures) {
        const gate = await requestOrReadPlaybookDecision({
          db, lead, runtime, type: "provider_failure", policy: geminiPolicy,
          nodeId: "gemini", operationId: "qualify_real_estate_lead",
          reason: "Gemini qualification is blocked: " + configured.code,
          leaseToken: claim.lease_token,
        });
        if (gate.state === "pending") return "blocked";
        if (gate.state === "denied") {
          await pausePlaybookLead(db, lead, claim.lease_token, "PLAYBOOK_GEMINI_PROVIDER_BLOCKED");
          return "blocked";
        }
        await retryClaim(db, claim, lead, "qualification", configured.code, true);
        return "blocked";
      }
      await retryClaim(db, claim, lead, "qualification", configured.code, true);
      return "blocked";
    }
    const operation = findOperation("gemini", "qualify_real_estate_lead", "action");
    if (!operation) {
      await retryClaim(db, claim, lead, "qualification", "GEMINI_OPERATION_NOT_REGISTERED", true);
      return "blocked";
    }
    try {
      const context = makeNodeContext({ gemini: configured.credentials });
      qualification = await operation.run(context, { leadData: qualificationInput(lead) }) as Qualification;
      const merged = mergeQualification(lead, qualification);
      await updateClaim(db, claim, merged);
      await markPlaybookDecisionExecuted(db, lead, qualificationDecisionId);
      lead = { ...lead, ...merged };
    } catch (error) {
      const code = safeErrorCode(error, "GEMINI_QUALIFICATION_FAILED");
      if (runtime.mode === "playbook" && runtime.definition?.review.reviewProviderFailures) {
        const gate = await requestOrReadPlaybookDecision({
          db, lead, runtime, type: "provider_failure", policy: geminiPolicy,
          nodeId: "gemini", operationId: "qualify_real_estate_lead",
          reason: "Gemini qualification failed: " + code,
          leaseToken: claim.lease_token,
        });
        if (gate.state === "pending") return "blocked";
        if (gate.state === "denied") {
          await pausePlaybookLead(db, lead, claim.lease_token, "PLAYBOOK_GEMINI_PROVIDER_BLOCKED");
          return "blocked";
        }
        await retryClaim(db, claim, lead, "qualification", code, false);
        return "failed";
      }
      await retryClaim(db, claim, lead, "qualification", code, false);
      return "failed";
    }
  }

  try {
    await ensureFollowupDrafts(db, lead, qualification);
    await ensureQualificationActivity(db, lead, claim.workspace_id, Number(lead.lead_score));
    await ensureBackOfficeTask(db, lead);
  } catch (error) {
    const code = safeErrorCode(error, "LEAD_PIPELINE_PERSISTENCE_FAILED");
    await retryClaim(db, claim, lead, "pipeline", code, false);
    return "failed";
  }

  let ruleResults: Array<{ nodeId: string; route: string | null }> = [];
  if (runtime.mode === "playbook" && runtime.definition && runtime.steps) {
    const replay = replayPlaybookAgainstLead(runtime.definition, runtime.steps, lead);
    ruleResults = replay.rules.map((rule) => ({ nodeId: rule.nodeId, route: rule.route }));
    const { data: existingEvaluation, error: lookupError } = await db.from("real_estate_lead_activities")
      .select("id").eq("workspace_id", claim.workspace_id).eq("lead_id", lead.id)
      .eq("activity_type", "lead.playbook_rules_evaluated")
      .contains("details", { workflowVersion: runtime.version }).limit(1).maybeSingle();
    if (lookupError) throw new Error("PLAYBOOK_RULE_AUDIT_LOOKUP_FAILED");
    if (!existingEvaluation) {
      const { error: eventError } = await db.from("real_estate_lead_activities").insert({
        workspace_id: claim.workspace_id, lead_id: lead.id, actor_user_id: null,
        activity_type: "lead.playbook_rules_evaluated",
        details: {
          workflowId: runtime.workflowId,
          workflowVersion: runtime.version,
          confidence: replay.confidence,
          confidenceThreshold: replay.confidenceThreshold,
          matchedRules: replay.matchedRules,
          rules: replay.rules.map((rule) => ({ id: rule.id, nodeId: rule.nodeId, name: rule.name, outcome: rule.outcome, reason: rule.reason })),
          reviewReasons: replay.reviewReasons,
        },
      });
      if (eventError) throw new Error("PLAYBOOK_RULE_AUDIT_WRITE_FAILED");
    }
    if (replay.requiresReview) {
      const gate = await requestOrReadPlaybookDecision({
        db, lead, runtime, type: "qualification_review",
        reason: replay.reviewReasons.join(" ") || "This enquiry needs a human review before the next action.",
        leaseToken: claim.lease_token,
      });
      if (gate.state === "pending") return "blocked";
      if (gate.state === "denied") {
        await pausePlaybookLead(db, lead, claim.lease_token, "PLAYBOOK_QUALIFICATION_REVIEW_REJECTED");
        return "blocked";
      }
      await markPlaybookDecisionExecuted(db, lead, gate.decisionId);
    }
  }

  let notificationSkipped = false;
  let notificationDecisionId: string | undefined;
  const emailPolicy = runtime.mode === "playbook" ? getPlaybookPolicy(runtime, "email", "send_email") : null;
  if (runtime.mode === "playbook") {
    if (!emailPolicy || emailPolicy.permission === "never" ||
        !isPlaybookActionOnSelectedBranch(runtime, emailPolicy, ruleResults)) {
      notificationSkipped = true;
      await updateClaim(db, claim, { agent_notification_status: "not_required", agent_notification_error_code: null });
      const { data: priorSkip } = await db.from("real_estate_lead_activities").select("id")
        .eq("workspace_id", claim.workspace_id).eq("lead_id", lead.id)
        .eq("activity_type", "lead.playbook_action_skipped")
        .contains("details", { workflowVersion: runtime.version, operationId: "send_email" }).limit(1).maybeSingle();
      if (!priorSkip) {
        await db.from("real_estate_lead_activities").insert({
          workspace_id: claim.workspace_id, lead_id: lead.id, actor_user_id: null,
          activity_type: "lead.playbook_action_skipped",
          details: {
            workflowVersion: runtime.version, stepId: emailPolicy?.stepId ?? null,
            nodeId: "email", operationId: "send_email",
            permission: emailPolicy?.permission ?? "not_configured",
            reason: !emailPolicy ? "No agency email action is configured." :
              emailPolicy.permission === "never" ? "Action is disabled by Playbook policy." :
              "The selected deterministic rule branch does not include this action.",
          },
        });
      }
    }
  }

  if (!notificationSkipped && lead.agent_notification_status !== "accepted") {
    if (runtime.mode === "playbook" && emailPolicy) {
      const gate = await requestOrReadPlaybookDecision({
        db, lead, runtime, type: "action_approval", policy: emailPolicy,
        reason: "The Playbook requires approval before sending the agency notification.",
        leaseToken: claim.lease_token,
      });
      if (gate.state === "pending") return "blocked";
      if (gate.state === "denied") {
        await pausePlaybookLead(db, lead, claim.lease_token, "PLAYBOOK_EMAIL_ACTION_BLOCKED");
        return "blocked";
      }
      notificationDecisionId = gate.decisionId;
    }

    try {
      const emailStep = runtime.mode === "playbook" && emailPolicy
        ? runtime.steps?.find((step) => step.id === emailPolicy.stepId)
        : undefined;
      const notification = await sendAgentNotifications(
        db, claim, { ...lead, ...(qualification ? mergeQualification(lead, qualification) : {}) },
        qualification, emailStep?.connectionId, runtime.mode === "playbook",
      );
      if (!notification.ok) {
        if (runtime.mode === "playbook" && runtime.definition?.review.reviewProviderFailures && emailPolicy) {
          const gate = await requestOrReadPlaybookDecision({
            db, lead, runtime, type: "provider_failure", policy: emailPolicy,
            reason: "Agency notification is blocked: " + notification.code,
            leaseToken: claim.lease_token,
          });
          if (gate.state === "pending") return "blocked";
          if (gate.state === "denied") {
            await pausePlaybookLead(db, lead, claim.lease_token, "PLAYBOOK_EMAIL_PROVIDER_BLOCKED");
            return "blocked";
          }
          await retryClaim(db, claim, lead, "notification", notification.code, notification.blocked);
          return notification.blocked ? "blocked" : "failed";
        }
        await retryClaim(db, claim, lead, "notification", notification.code, notification.blocked);
        return notification.blocked ? "blocked" : "failed";
      }
      await markPlaybookDecisionExecuted(db, lead, notificationDecisionId);
    } catch (error) {
      const code = safeErrorCode(error, "AGENT_NOTIFICATION_FAILED");
      if (runtime.mode === "playbook" && runtime.definition?.review.reviewProviderFailures && emailPolicy) {
        const gate = await requestOrReadPlaybookDecision({
          db, lead, runtime, type: "provider_failure", policy: emailPolicy,
          reason: "Agency notification failed: " + code,
          leaseToken: claim.lease_token,
        });
        if (gate.state === "pending") return "blocked";
        if (gate.state === "denied") {
          await pausePlaybookLead(db, lead, claim.lease_token, "PLAYBOOK_EMAIL_PROVIDER_BLOCKED");
          return "blocked";
        }
        await retryClaim(db, claim, lead, "notification", code, /CONNECTION_NOT_VERIFIED|NOT_APPROVED|CREDENTIALS|EMAIL_NOT_FOUND/.test(code));
        return "failed";
      }
      await retryClaim(db, claim, lead, "notification", code, /CONNECTION_NOT_VERIFIED|NOT_APPROVED|CREDENTIALS|EMAIL_NOT_FOUND/.test(code));
      return "failed";
    }
  }

  if (runtime.mode === "playbook") {
    const whatsapp = await sendWhatsAppTemplate(db, claim, lead, runtime, ruleResults);
    if (whatsapp.state === "paused") return "blocked";
    if (whatsapp.state === "retry") {
      await retryClaim(db, claim, lead, "pipeline", whatsapp.code ?? "WHATSAPP_RETRYABLE_FAILURE", false);
      return "failed";
    }
    if (whatsapp.state === "blocked") {
      await retryClaim(db, claim, lead, "pipeline", whatsapp.code ?? "WHATSAPP_ACTION_BLOCKED", true);
      return "blocked";
    }

    const crm = await syncRealEstateCrmContact(db, claim, lead, runtime, ruleResults);
    if (crm.state === "paused") return "blocked";
    if (crm.state === "retry") {
      await retryClaim(db, claim, lead, "pipeline", crm.code ?? "CRM_SYNC_RETRYABLE_FAILURE", false);
      return "failed";
    }
    if (crm.state === "blocked") {
      await retryClaim(db, claim, lead, "pipeline", crm.code ?? "CRM_ACTION_BLOCKED", true);
      return "blocked";
    }
  }

  await updateClaim(db, claim, {
    pipeline_status: "completed",
    pipeline_last_error_code: null,
    pipeline_lease_token: null,
    pipeline_lease_until: null,
    pipeline_next_attempt_at: new Date().toISOString(),
    qualification_status: "succeeded",
    agent_notification_status: notificationSkipped ? "not_required" : "accepted",
    agent_notification_error_code: null,
    agent_notified_at: notificationSkipped ? lead.agent_notified_at : (lead.agent_notified_at ?? new Date().toISOString()),
  });
  return "completed";
}

/**
 * Processes durable, workspace-scoped lead jobs. A SQL lease prevents two cron
 * invocations or duplicate webhooks from qualifying/notifying the same lead.
 * Gemini and Resend are invoked through the existing registered node actions.
 */
export async function processRealEstateLeadPipeline(options: {
  db?: ServiceClient;
  workspaceId?: string;
  leadId?: string;
  limit?: number;
} = {}) {
  if (process.env.REAL_ESTATE_PIPELINE_ENABLED !== "true" || process.env.AIVANTA_LIVE_EXECUTION_ENABLED !== "true") {
    return { enabled: false, claimed: 0, completed: 0, blocked: 0, failed: 0 };
  }
  const db = options.db ?? createRealEstateServiceClient();
  const { data, error } = await db.rpc("claim_due_real_estate_lead_pipeline", {
    p_limit: options.leadId ? 1 : Math.max(1, Math.min(50, options.limit ?? 20)),
    p_lease_seconds: 180,
    p_lead_id: options.leadId ?? null,
    p_workspace_id: options.workspaceId ?? null,
  });
  if (error || !Array.isArray(data)) throw new Error("PIPELINE_CLAIM_FAILED");
  const claims = data as PipelineClaim[];
  const counts = { enabled: true, claimed: claims.length, completed: 0, blocked: 0, failed: 0 };
  for (const claim of claims) {
    try {
      const result = await processClaim(db, claim);
      if (result === "completed") counts.completed++;
      else if (result === "blocked") counts.blocked++;
      else counts.failed++;
    } catch (error) {
      const { data: lead } = await db.from("real_estate_leads").select("pipeline_attempt_count")
        .eq("id", claim.lead_id).eq("workspace_id", claim.workspace_id).maybeSingle();
      await retryClaim(db, claim, lead ?? { pipeline_attempt_count: 1 }, "pipeline", safeErrorCode(error, "PIPELINE_EXECUTION_FAILED"), false);
      counts.failed++;
    }
  }
  return counts;
}
