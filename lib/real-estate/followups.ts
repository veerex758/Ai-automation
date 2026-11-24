import "server-only";
import { decryptWorkspaceCredentials } from "@/lib/integrations/workspace-credentials";
import { findOperation } from "@/nodes/registry";
import type { NodeContext } from "@/nodes/types";
import { createRealEstateServiceClient } from "@/lib/real-estate/server";
import { loadPlaybookRuntime } from "@/lib/playbooks/runtime";

type Claim = {
  id: string;
  workspace_id: string;
  lead_id: string;
  sequence: number;
  due_at: string;
  subject: string;
  message: string;
  attempt_count: number;
  max_attempts: number;
  lease_token: string;
};

async function finish(
  db: ReturnType<typeof createRealEstateServiceClient>,
  claim: Claim,
  ok: boolean,
  providerMessageId: string | null,
  errorCode: string | null,
  retryable: boolean,
) {
  const { data, error } = await db.rpc("finish_real_estate_followup", {
    p_followup_id: claim.id,
    p_lease_token: claim.lease_token,
    p_accepted: ok,
    p_provider_message_id: providerMessageId,
    p_error_code: errorCode,
    p_retryable: retryable,
  });
  if (error || data !== true) throw new Error("FOLLOWUP_FINALIZE_FAILED");
}

async function sendOne(db: ReturnType<typeof createRealEstateServiceClient>, claim: Claim) {
  const { data: lead, error: leadError } = await db.from("real_estate_leads")
    .select("id,full_name,email,contact_preference,consent_to_contact,consent_text,consent_at,customer_responded_at,agent_takeover_at,status,last_contacted_at,workflow_id,playbook_version")
    .eq("id", claim.lead_id).eq("workspace_id", claim.workspace_id).maybeSingle();
  if (leadError) throw new Error("FOLLOWUP_LEAD_LOOKUP_FAILED");
  if (!lead || !lead.consent_to_contact || !lead.consent_at || !lead.consent_text || lead.contact_preference !== "email" || !lead.email ||
    lead.customer_responded_at || lead.agent_takeover_at || ["won", "lost"].includes(lead.status)) {
    const { error } = await db.from("real_estate_followups")
      .update({ status: "cancelled", lease_token: null, lease_until: null, last_error_code: "FOLLOWUP_STOP_CONDITION" })
      .eq("id", claim.id).eq("workspace_id", claim.workspace_id).eq("lease_token", claim.lease_token);
    if (error) throw new Error("FOLLOWUP_CANCEL_FAILED");
    return "cancelled";
  }
  if (process.env.REAL_ESTATE_FOLLOWUPS_ENABLED !== "true" || process.env.AIVANTA_LIVE_EXECUTION_ENABLED !== "true") {
    await finish(db, claim, false, null, "FOLLOWUP_LIVE_EXECUTION_DISABLED", false);
    return "blocked";
  }

  const runtime = await loadPlaybookRuntime(db, {
    id: lead.id,
    workspace_id: claim.workspace_id,
    workflow_id: lead.workflow_id,
    playbook_version: lead.playbook_version,
  });
  if (runtime.mode === "invalid") {
    await finish(db, claim, false, null, runtime.reason ?? "FOLLOWUP_PLAYBOOK_INVALID", false);
    return "blocked";
  }
  const selectedConnectionId = runtime.mode === "playbook"
    ? runtime.steps?.find((step) => step.nodeId === "email" && step.operationId === "send_email")?.connectionId
    : undefined;
  let integrationQuery = db.from("workspace_integrations").select("id,status,last_test_status")
    .eq("workspace_id", claim.workspace_id).eq("provider", "resend");
  if (selectedConnectionId) integrationQuery = integrationQuery.eq("id", selectedConnectionId);
  const [
    { data: integrations, error: integrationError },
    { data: approval, error: approvalError },
  ] = await Promise.all([
    integrationQuery.order("created_at", { ascending: false }).limit(selectedConnectionId ? 1 : 2),
    db.from("workspace_provider_operation_approvals").select("decision")
      .eq("workspace_id", claim.workspace_id).eq("provider", "resend")
      .eq("node_id", "email").eq("operation_id", "send_email")
      .order("decided_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (integrationError || approvalError) throw new Error("FOLLOWUP_PROVIDER_CHECK_FAILED");
  if (!integrations?.length || integrations.length !== 1) {
    await finish(db, claim, false, null, integrations?.length ? "WORKSPACE_CONNECTION_SELECTION_REQUIRED" : "RESEND_CONNECTION_OR_APPROVAL_REQUIRED", false);
    return "blocked";
  }
  const integration = integrations[0];
  if (integration.status !== "connected" || integration.last_test_status !== "passed" || approval?.decision !== "approved") {
    await finish(db, claim, false, null, "RESEND_CONNECTION_OR_APPROVAL_REQUIRED", false);
    return "blocked";
  }

  const { data: secret, error: secretError } = await db.from("workspace_integration_secrets")
    .select("encrypted_credentials,encryption_version").eq("integration_id", integration.id).maybeSingle();
  if (secretError || !secret || !["v1", "v2"].includes(secret.encryption_version)) {
    await finish(db, claim, false, null, "RESEND_CREDENTIALS_UNAVAILABLE", false);
    return "blocked";
  }

  let credentials: ReturnType<typeof decryptWorkspaceCredentials>["resend"];
  const associatedData = secret.encryption_version === "v2"
    ? claim.workspace_id + ":resend:" + integration.id
    : claim.workspace_id + ":resend";
  try {
    credentials = decryptWorkspaceCredentials(secret.encrypted_credentials, undefined, associatedData).resend;
  } catch {
    await finish(db, claim, false, null, "RESEND_CREDENTIALS_DECRYPT_FAILED", false);
    return "blocked";
  }
  if (!credentials?.apiKey || !credentials.fromEmail) {
    await finish(db, claim, false, null, "RESEND_CREDENTIALS_INCOMPLETE", false);
    return "blocked";
  }

  const operation = findOperation("email", "send_email", "action");
  if (!operation) {
    await finish(db, claim, false, null, "RESEND_OPERATION_NOT_REGISTERED", false);
    return "failed";
  }
  const context: NodeContext = {
    credentials: { resend: credentials },
    previousOutputs: {},
    logger: {
      info(message, meta) { console.info("[real-estate-followups]", message, meta ?? {}); },
      error(message, meta) { console.error("[real-estate-followups]", message, meta ?? {}); },
    },
    http: {
      async request(args) {
        let response: Response;
        try {
          response = await fetch(args.url, {
            method: args.method,
            headers: args.headers,
            body: args.body === undefined ? undefined : JSON.stringify(args.body),
            cache: "no-store",
            redirect: "error",
            signal: AbortSignal.timeout(Math.min(30000, Math.max(1000, args.timeoutMs ?? 15000))),
          });
        } catch {
          throw new Error("RESEND_NETWORK_ERROR");
        }
        const raw = await response.text();
        let body: unknown;
        try { body = raw ? JSON.parse(raw) : {}; } catch { body = raw; }
        return { status: response.status, body };
      },
    },
  };

  let messageId: string;
  try {
    const result = await operation.run(context, {
      to: lead.email,
      subject: claim.subject,
      text: claim.message,
      idempotencyKey: "real-estate-followup:" + claim.id,
    }) as { messageId?: string };
    if (typeof result?.messageId !== "string" || !result.messageId) throw new Error("EMAIL_PROVIDER_RESULT_INVALID");
    messageId = result.messageId;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const errorCode = /^[A-Z0-9_]{1,80}$/.test(message) ? message : "RESEND_SEND_FAILED";
    const retryable = ["RESEND_NETWORK_ERROR", "EMAIL_RATE_LIMITED", "EMAIL_PROVIDER_UNAVAILABLE"].includes(errorCode);
    await finish(db, claim, false, null, errorCode, retryable);
    return retryable ? "retry" : "failed";
  }

  await finish(db, claim, true, messageId, null, false);
  const now = new Date().toISOString();
  await Promise.all([
    db.from("real_estate_leads").update({
      first_contacted_at: lead.last_contacted_at ?? now,
      last_contacted_at: now,
    }).eq("id", lead.id).eq("workspace_id", claim.workspace_id),
    db.from("real_estate_lead_activities").insert({
      workspace_id: claim.workspace_id,
      lead_id: lead.id,
      actor_user_id: null,
      activity_type: "followup.email_accepted",
      details: {
        followupId: claim.id,
        sequence: claim.sequence,
        provider: "resend",
        providerMessageId: messageId,
      },
    }),
  ]);
  return "sent";
}

/** Process due, consent-eligible email follow-ups using leased queue claims. */
export async function processDueRealEstateFollowups(
  db: ReturnType<typeof createRealEstateServiceClient> = createRealEstateServiceClient(),
) {
  if (process.env.REAL_ESTATE_FOLLOWUPS_ENABLED !== "true" || process.env.AIVANTA_LIVE_EXECUTION_ENABLED !== "true") {
    return { enabled: false, claimed: 0, sent: 0, retried: 0, failed: 0, blocked: 0, cancelled: 0 };
  }
  const { data, error } = await db.rpc("claim_due_real_estate_followups", {
    p_limit: 20,
    p_lease_seconds: 180,
  });
  if (error || !Array.isArray(data)) throw new Error("FOLLOWUP_CLAIM_FAILED");

  const counts = { enabled: true, claimed: data.length, sent: 0, retried: 0, failed: 0, blocked: 0, cancelled: 0 };
  for (const claim of data as Claim[]) {
    try {
      const result = await sendOne(db, claim);
      if (result === "sent") counts.sent++;
      else if (result === "retry") counts.retried++;
      else if (result === "failed") counts.failed++;
      else if (result === "blocked") counts.blocked++;
      else counts.cancelled++;
    } catch (error) {
      console.error("Follow-up execution failed", {
        followupId: claim.id,
        errorCode: error instanceof Error && /^[A-Z0-9_]{1,80}$/.test(error.message)
          ? error.message : "FOLLOWUP_EXECUTION_FAILED",
      });
      try {
        await finish(db, claim, false, null, "FOLLOWUP_EXECUTION_FAILED", true);
        counts.retried++;
      } catch {
        counts.failed++;
      }
    }
  }
  return counts;
}
