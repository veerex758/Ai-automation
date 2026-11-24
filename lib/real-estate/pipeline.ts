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
import type { PlaybookRuntime } from "@/lib/playbooks/runtime";

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
  assigned_agent_id: string | null;
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
  requireLiveOptIn = false,
  selectedConnectionId?: string,
): Promise<CredentialResult> {
  const mapping = getWorkerOperationMapping({ kind: "action", nodeId, operationId });
  if (!mapping || mapping.provider !== provider) return { ok: false, code: "PROVIDER_OPERATION_NOT_REGISTERED" };
  if (requireLiveOptIn && !isProviderLiveEnabled(provider, process.env.AIVANTA_LIVE_INTEGRATIONS)) {
    return { ok: false, code: provider.toUpperCase() + "_LIVE_INTEGRATION_DISABLED" };
  }

  let integrationQuery = db.from("workspace_integrations")
    .select("id,status,last_test_status")
    .eq("workspace_id", workspaceId)
    .eq("provider", provider);
  if (selectedConnectionId) integrationQuery = integrationQuery.eq("id", selectedConnectionId);
  integrationQuery = integrationQuery.order("created_at", { ascending: false }).limit(selectedConnectionId ? 1 : 2);

  const [{ data: integrations, error: integrationError }, { data: approval, error: approvalError }] = await Promise.all([
    integrationQuery,
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
  if (integrationError || approvalError) return { ok: false, code: "PROVIDER_READINESS_LOOKUP_FAILED" };
  if (!integrations?.length) return { ok: false, code: provider.toUpperCase() + "_CONNECTION_NOT_VERIFIED" };
  if (integrations.length !== 1) return { ok: false, code: "WORKSPACE_CONNECTION_SELECTION_REQUIRED" };
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
  const associatedData = secret.encryption_version === "v2"
    ? workspaceId + ":" + provider + ":" + integration.id
    : workspaceId + ":" + provider;
  try {
    const decoded = decryptWorkspaceCredentials(secret.encrypted_credentials, undefined, associatedData);
    const credentials = decoded[provider];
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

async function ensureBackOfficeTask(db: ServiceClient, lead: LeadRow, score: number) {
  const priority = score >= 80 ? "urgent" : score >= 60 ? "high" : "normal";
  const { error } = await db.from("real_estate_tasks").upsert({
    workspace_id: lead.workspace_id,
    lead_id: lead.id,
    assigned_agent_id: lead.assigned_agent_id,
    task_type: "new_enquiry_review",
    title: "Review and assign new property enquiry",
    description: "Review the qualification summary, confirm the customer's requirements, and assign the next action. Contact the customer only through the recorded consent channel.",
    status: "open",
    priority,
    due_at: new Date(Date.now() + (score >= 80 ? 15 : 60) * 60 * 1000).toISOString(),
    idempotency_key: "lead:" + lead.id + ":new-enquiry-review:v1",
    created_by: null,
  }, { onConflict: "workspace_id,idempotency_key", ignoreDuplicates: true });
  if (error) throw new Error("REAL_ESTATE_BACK_OFFICE_TASK_FAILED");
}
async function ensureFollowupDrafts(db: ServiceClient, lead: LeadRow, qualification: Qualification) {
  if (!lead.consent_to_contact || lead.contact_preference !== "email" || !lead.email) return;
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
  runtime: PlaybookRuntime,
) {
  const selectedConnectionId = runtime.steps?.find((step) => step.nodeId === "email" && step.operationId === "send_email")?.connectionId;
  const configured = await approvedCredentials(db, claim.workspace_id, "resend", "email", "send_email", false, selectedConnectionId);
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

async function sendConsentedWhatsApp(
  db: ServiceClient,
  claim: PipelineClaim,
  lead: LeadRow,
  runtime: Awaited<ReturnType<typeof loadPlaybookRuntime>>,
  ruleResults: Array<{ nodeId: string; route: string | null }>,
): Promise<"sent" | "skipped" | "pending"> {
  if (runtime.mode !== "playbook") return "skipped";
  const policy = getPlaybookPolicy(runtime, "whatsapp_business", "send_template");
  if (!policy || policy.permission === "never" || !isPlaybookActionOnSelectedBranch(runtime, policy, ruleResults)) {
    return "skipped";
  }

  const consentText = (lead.consent_text ?? "").toLowerCase();
  const consentRecorded = lead.consent_to_contact === true &&
    lead.contact_preference === "whatsapp" &&
    Boolean(lead.consent_at && Number.isFinite(Date.parse(lead.consent_at))) &&
    /whatsapp/.test(consentText);
  if (!consentRecorded || !lead.phone || !/^\+[1-9]\d{7,14}$/.test(lead.phone)) {
    await db.from("real_estate_lead_activities").insert({
      workspace_id: lead.workspace_id, lead_id: lead.id, actor_user_id: null,
      activity_type: "lead.whatsapp_skipped",
      details: { reason: "WHATSAPP_CHANNEL_CONSENT_REQUIRED", channel: lead.contact_preference },
    });
    return "skipped";
  }

  const approval = await requestOrReadPlaybookDecision({
    db, lead, runtime, type: "action_approval", policy,
    reason: "The Playbook requires approval before sending the approved WhatsApp template to this consenting customer.",
    leaseToken: claim.lease_token,
  });
  if (approval.state === "pending") return "pending";
  if (approval.state === "denied") return "skipped";

  const configured = await approvedCredentials(db, claim.workspace_id, "whatsapp_business", "whatsapp_business", "send_template", true, runtime.steps?.find((step) => step.nodeId === "whatsapp_business" && step.operationId === "send_template")?.connectionId);
  if (!configured.ok) {
    if (runtime.definition.review.reviewProviderFailures) {
      const review = await requestOrReadPlaybookDecision({
        db, lead, runtime, type: "provider_failure", policy,
        nodeId: "whatsapp_business", operationId: "send_template",
        reason: "WhatsApp delivery is blocked until the provider connection and operation approval are verified: " + configured.code,
        leaseToken: claim.lease_token,
      });
      if (review.state === "pending") return "pending";
    }
    await db.from("real_estate_lead_activities").insert({
      workspace_id: lead.workspace_id, lead_id: lead.id, actor_user_id: null,
      activity_type: "lead.whatsapp_blocked",
      details: { reason: configured.code, channel: "whatsapp" },
    });
    return "skipped";
  }

  const idempotencyKey = "real-estate:" + lead.id + ":whatsapp:welcome:v1";
  const { data: delivery, error: deliveryError } = await db.from("real_estate_channel_deliveries").insert({
    workspace_id: claim.workspace_id,
    lead_id: lead.id,
    channel: "whatsapp",
    sequence: 1,
    status: "sending",
    idempotency_key: idempotencyKey,
  }).select("id,status").single();
  if (deliveryError?.code === "23505") {
    const { data: prior, error: priorError } = await db.from("real_estate_channel_deliveries")
      .select("id,status").eq("workspace_id", claim.workspace_id)
      .eq("idempotency_key", idempotencyKey).maybeSingle();
    if (priorError) throw new Error("WHATSAPP_DELIVERY_LOOKUP_FAILED");
    if (prior?.status === "accepted") {
      await markPlaybookDecisionExecuted(db, lead, approval.decisionId);
      return "sent";
    }
    // A sending/unknown/failed row is never re-sent automatically. This avoids
    // duplicate customer messages after an ambiguous provider timeout.
    return "skipped";
  }
  if (deliveryError || !delivery) throw new Error("WHATSAPP_DELIVERY_LEDGER_WRITE_FAILED");

  const operation = findOperation("whatsapp_business", "send_template", "action");
  if (!operation) {
    await db.from("real_estate_channel_deliveries").update({
      status: "failed", last_error_code: "WHATSAPP_OPERATION_NOT_REGISTERED", updated_at: new Date().toISOString(),
    }).eq("id", delivery.id).eq("workspace_id", claim.workspace_id);
    return "skipped";
  }
  try {
    const result = await operation.run(makeNodeContext({ whatsapp_business: configured.credentials }), { to: lead.phone }) as { messageId?: string };
    if (typeof result?.messageId !== "string" || !result.messageId) throw new Error("WHATSAPP_PROVIDER_RESULT_INVALID");
    const now = new Date().toISOString();
    const { error: acceptedError } = await db.from("real_estate_channel_deliveries").update({
      status: "accepted", provider_message_id: result.messageId, accepted_at: now, updated_at: now, last_error_code: null,
    }).eq("id", delivery.id).eq("workspace_id", claim.workspace_id).eq("status", "sending");
    if (acceptedError) throw new Error("WHATSAPP_DELIVERY_FINALIZE_FAILED");
    await db.from("real_estate_lead_activities").insert({
      workspace_id: claim.workspace_id, lead_id: lead.id, actor_user_id: null,
      activity_type: "lead.whatsapp_template_accepted",
      details: { provider: "whatsapp_business", providerMessageId: result.messageId, sequence: 1 },
    });
    await markPlaybookDecisionExecuted(db, lead, approval.decisionId);
    return "sent";
  } catch (error) {
    const code = safeErrorCode(error, "WHATSAPP_SEND_FAILED");
    const uncertain = /NETWORK|TIMEOUT|ABORT|FETCH|PROVIDER_RESULT_INVALID/.test(code);
    await db.from("real_estate_channel_deliveries").update({
      status: uncertain ? "unknown" : "failed",
      last_error_code: code,
      updated_at: new Date().toISOString(),
    }).eq("id", delivery.id).eq("workspace_id", claim.workspace_id).eq("status", "sending");
    await db.from("real_estate_lead_activities").insert({
      workspace_id: claim.workspace_id, lead_id: lead.id, actor_user_id: null,
      activity_type: "lead.whatsapp_delivery_failed",
      details: { errorCode: code, deliveryStatus: uncertain ? "unknown" : "failed" },
    });
    return "skipped";
  }
}

async function syncConfiguredCrmContact(
  db: ServiceClient,
  claim: PipelineClaim,
  lead: LeadRow,
  runtime: Awaited<ReturnType<typeof loadPlaybookRuntime>>,
  ruleResults: Array<{ nodeId: string; route: string | null }>,
): Promise<"created" | "matched" | "skipped" | "pending"> {
  if (runtime.mode !== "playbook" || !lead.email) return "skipped";
  const providers = ["pipedrive", "zoho_crm", "freshsales"];
  const selected = providers.filter((provider) => runtime.steps?.some((step) => step.kind === "action" && step.nodeId === provider));
  if (!selected.length) return "skipped";
  if (selected.length !== 1) throw new Error("PLAYBOOK_MULTIPLE_CRM_PROVIDERS");
  const provider = selected[0];
  const searchPolicy = getPlaybookPolicy(runtime, provider, "search_contacts");
  const createPolicy = getPlaybookPolicy(runtime, provider, "execute");
  if (!searchPolicy || !createPolicy || searchPolicy.permission === "never" || createPolicy.permission === "never" ||
      !isPlaybookActionOnSelectedBranch(runtime, searchPolicy, ruleResults) ||
      !isPlaybookActionOnSelectedBranch(runtime, createPolicy, ruleResults)) return "skipped";

  const searchApproval = await requestOrReadPlaybookDecision({
    db, lead, runtime, type: "action_approval", policy: searchPolicy,
    reason: "The Playbook needs permission to search the connected CRM for an exact email match before creating a contact.",
    leaseToken: claim.lease_token,
  });
  if (searchApproval.state === "pending") return "pending";
  if (searchApproval.state === "denied") return "skipped";

  const searchCredentials = await approvedCredentials(db, claim.workspace_id, provider, provider, "search_contacts", true, runtime.steps?.find((step) => step.nodeId === provider && step.operationId === "search_contacts")?.connectionId);
  if (!searchCredentials.ok) {
    if (runtime.definition.review.reviewProviderFailures) {
      const review = await requestOrReadPlaybookDecision({
        db, lead, runtime, type: "provider_failure", policy: searchPolicy,
        nodeId: provider, operationId: "search_contacts",
        reason: "CRM exact-match search is blocked until the provider connection and operation approval are verified: " + searchCredentials.code,
        leaseToken: claim.lease_token,
      });
      if (review.state === "pending") return "pending";
    }
    await db.from("real_estate_lead_activities").insert({
      workspace_id: claim.workspace_id, lead_id: lead.id, actor_user_id: null,
      activity_type: "lead.crm_sync_blocked",
      details: { provider, operationId: "search_contacts", errorCode: searchCredentials.code },
    });
    return "skipped";
  }

  const searchOperation = findOperation(provider, "search_contacts", "action");
  if (!searchOperation) throw new Error("CRM_SEARCH_OPERATION_NOT_REGISTERED");
  let searchResult: { contacts?: Array<{ contactId: string; email?: string }> };
  try {
    searchResult = await searchOperation.run(makeNodeContext({ [provider]: searchCredentials.credentials }), { email: lead.email }) as typeof searchResult;
  } catch (error) {
    const code = safeErrorCode(error, "CRM_SEARCH_FAILED");
    if (runtime.definition.review.reviewProviderFailures) {
      const review = await requestOrReadPlaybookDecision({
        db, lead, runtime, type: "provider_failure", policy: searchPolicy, nodeId: provider, operationId: "search_contacts",
        reason: "CRM exact-match search failed: " + code, leaseToken: claim.lease_token,
      });
      if (review.state === "pending") return "pending";
    }
    await db.from("real_estate_lead_activities").insert({
      workspace_id: claim.workspace_id, lead_id: lead.id, actor_user_id: null,
      activity_type: "lead.crm_sync_blocked", details: { provider, operationId: "search_contacts", errorCode: code },
    });
    return "skipped";
  }

  const exactMatches = (searchResult.contacts ?? []).filter((contact) =>
    typeof contact.email === "string" && contact.email.trim().toLowerCase() === lead.email!.trim().toLowerCase()
  );
  await markPlaybookDecisionExecuted(db, lead, searchApproval.decisionId);
  if (exactMatches.length > 0) {
    await db.from("real_estate_lead_activities").insert({
      workspace_id: claim.workspace_id, lead_id: lead.id, actor_user_id: null,
      activity_type: "lead.crm_contact_matched",
      details: { provider, exactMatchCount: exactMatches.length, contactId: exactMatches[0].contactId },
    });
    return "matched";
  }

  const createApproval = await requestOrReadPlaybookDecision({
    db, lead, runtime, type: "action_approval", policy: createPolicy,
    reason: "No exact email match was found. The Playbook requests permission to create one CRM contact.",
    leaseToken: claim.lease_token,
  });
  if (createApproval.state === "pending") return "pending";
  if (createApproval.state === "denied") return "skipped";

  const createCredentials = await approvedCredentials(db, claim.workspace_id, provider, provider, "execute", true, runtime.steps?.find((step) => step.nodeId === provider && step.operationId === "execute")?.connectionId);
  if (!createCredentials.ok) {
    if (runtime.definition.review.reviewProviderFailures) {
      const review = await requestOrReadPlaybookDecision({
        db, lead, runtime, type: "provider_failure", policy: createPolicy,
        nodeId: provider, operationId: "execute",
        reason: "CRM contact creation is blocked until the provider connection and operation approval are verified: " + createCredentials.code,
        leaseToken: claim.lease_token,
      });
      if (review.state === "pending") return "pending";
    }
    await db.from("real_estate_lead_activities").insert({
      workspace_id: claim.workspace_id, lead_id: lead.id, actor_user_id: null,
      activity_type: "lead.crm_sync_blocked", details: { provider, operationId: "execute", errorCode: createCredentials.code },
    });
    return "skipped";
  }

  const createOperation = findOperation(provider, "execute", "action");
  if (!createOperation) throw new Error("CRM_CREATE_OPERATION_NOT_REGISTERED");
  const nameParts = lead.full_name.trim().split(/\s+/);
  try {
    const created = await createOperation.run(makeNodeContext({ [provider]: createCredentials.credentials }), {
      email: lead.email,
      firstName: nameParts[0] || "Customer",
      lastName: nameParts.slice(1).join(" ") || "Enquiry",
      ...(lead.phone ? { phone: lead.phone } : {}),
    }) as { contactId?: string };
    if (typeof created?.contactId !== "string" || !created.contactId) throw new Error("CRM_CREATE_RESULT_INVALID");
    await db.from("real_estate_lead_activities").insert({
      workspace_id: claim.workspace_id, lead_id: lead.id, actor_user_id: null,
      activity_type: "lead.crm_contact_created",
      details: { provider, contactId: created.contactId, idempotencyKey: "lead:" + lead.id + ":crm:" + provider },
    });
    await markPlaybookDecisionExecuted(db, lead, createApproval.decisionId);
    return "created";
  } catch (error) {
    // A CRM may accept the create request and lose its response. Re-read by
    // exact email once before leaving the action for manual review. Do not
    // automatically issue a second create when the first result is ambiguous.
    const code = safeErrorCode(error, "CRM_CONTACT_CREATE_FAILED");
    let recoveredContact: { contactId: string } | null = null;
    try {
      const retrySearch = await searchOperation.run(
        makeNodeContext({ [provider]: searchCredentials.credentials }),
        { email: lead.email },
      ) as { contacts?: Array<{ contactId: string; email?: string }> };
      const matches = (retrySearch.contacts ?? []).filter((contact) =>
        typeof contact.email === "string" && contact.email.trim().toLowerCase() === lead.email!.trim().toLowerCase()
      );
      if (matches.length === 1) recoveredContact = { contactId: matches[0].contactId };
    } catch {
      // An unavailable reconciliation read leaves a review task, never a second create.
    }
    if (recoveredContact) {
      await db.from("real_estate_lead_activities").insert({
        workspace_id: claim.workspace_id, lead_id: lead.id, actor_user_id: null,
        activity_type: "lead.crm_contact_created_reconciled",
        details: { provider, contactId: recoveredContact.contactId, originalErrorCode: code },
      });
      await markPlaybookDecisionExecuted(db, lead, createApproval.decisionId);
      return "created";
    }
    await db.from("real_estate_tasks").upsert({
      workspace_id: claim.workspace_id, lead_id: lead.id, assigned_agent_id: lead.assigned_agent_id,
      task_type: "crm_review", title: "Review CRM contact synchronisation",
      description: "Rexnora could not confirm whether the CRM accepted the contact create request. Search the CRM by exact email before creating or editing a record.",
      status: "open", priority: "high", due_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      idempotency_key: "lead:" + lead.id + ":crm:" + provider + ":review:v1",
      created_by: null,
    }, { onConflict: "workspace_id,idempotency_key", ignoreDuplicates: true });
    await db.from("real_estate_lead_activities").insert({
      workspace_id: claim.workspace_id, lead_id: lead.id, actor_user_id: null,
      activity_type: "lead.crm_contact_create_failed", details: { provider, errorCode: code, manualReviewRequired: true },
    });
    return "skipped";
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

    const configured = await approvedCredentials(db, claim.workspace_id, "gemini", "gemini", "qualify_real_estate_lead", false, runtime.steps?.find((step) => step.nodeId === "gemini" && step.operationId === "qualify_real_estate_lead")?.connectionId);
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
    await ensureBackOfficeTask(db, lead, Number(lead.lead_score));
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
      const notification = await sendAgentNotifications(db, claim, { ...lead, ...(qualification ? mergeQualification(lead, qualification) : {}) }, qualification, runtime);
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

  const whatsappResult = await sendConsentedWhatsApp(db, claim, lead, runtime, ruleResults);
  if (whatsappResult === "pending") return "blocked";
  const crmResult = await syncConfiguredCrmContact(db, claim, lead, runtime, ruleResults);
  if (crmResult === "pending") return "blocked";

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
