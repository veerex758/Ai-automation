import "server-only";
import { decryptWorkspaceCredentials } from "@/lib/integrations/workspace-credentials";
import { createRealEstateServiceClient } from "@/lib/real-estate/server";

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
    .select("id,full_name,email,contact_preference,consent_to_contact,customer_responded_at,agent_takeover_at,status,last_contacted_at")
    .eq("id", claim.lead_id).eq("workspace_id", claim.workspace_id).maybeSingle();
  if (leadError) throw new Error("FOLLOWUP_LEAD_LOOKUP_FAILED");
  if (!lead || !lead.consent_to_contact || lead.contact_preference !== "email" || !lead.email ||
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

  const [
    { data: integration, error: integrationError },
    { data: approval, error: approvalError },
  ] = await Promise.all([
    db.from("workspace_integrations").select("id,status,last_test_status")
      .eq("workspace_id", claim.workspace_id).eq("provider", "resend").maybeSingle(),
    db.from("workspace_provider_operation_approvals").select("decision")
      .eq("workspace_id", claim.workspace_id).eq("provider", "resend")
      .eq("node_id", "email").eq("operation_id", "send_email")
      .order("decided_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (integrationError || approvalError) throw new Error("FOLLOWUP_PROVIDER_CHECK_FAILED");
  if (!integration || integration.status !== "connected" || integration.last_test_status !== "passed" ||
    approval?.decision !== "approved") {
    await finish(db, claim, false, null, "RESEND_CONNECTION_OR_APPROVAL_REQUIRED", false);
    return "blocked";
  }

  const { data: secret, error: secretError } = await db.from("workspace_integration_secrets")
    .select("encrypted_credentials,encryption_version").eq("integration_id", integration.id).maybeSingle();
  if (secretError || !secret || secret.encryption_version !== "v1") {
    await finish(db, claim, false, null, "RESEND_CREDENTIALS_UNAVAILABLE", false);
    return "blocked";
  }

  let credentials: ReturnType<typeof decryptWorkspaceCredentials>["resend"];
  try {
    credentials = decryptWorkspaceCredentials(
      secret.encrypted_credentials,
      undefined,
      claim.workspace_id + ":resend",
    ).resend;
  } catch {
    await finish(db, claim, false, null, "RESEND_CREDENTIALS_DECRYPT_FAILED", false);
    return "blocked";
  }
  if (!credentials?.apiKey || !credentials.fromEmail) {
    await finish(db, claim, false, null, "RESEND_CREDENTIALS_INCOMPLETE", false);
    return "blocked";
  }

  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + credentials.apiKey,
        "Content-Type": "application/json",
        "Idempotency-Key": "real-estate-followup:" + claim.id,
      },
      body: JSON.stringify({
        from: credentials.fromEmail,
        to: [lead.email],
        subject: claim.subject,
        text: claim.message,
      }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    await finish(db, claim, false, null, "RESEND_NETWORK_ERROR", true);
    return "retry";
  }

  const raw = await response.text();
  let body: unknown;
  try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
  const messageId = body && typeof body === "object" &&
    typeof (body as Record<string, unknown>).id === "string"
    ? (body as Record<string, string>).id
    : null;
  if (!response.ok || !messageId) {
    const errorCode = response.status === 429
      ? "RESEND_RATE_LIMITED"
      : response.status >= 500 ? "RESEND_PROVIDER_UNAVAILABLE" : "RESEND_SEND_REJECTED";
    await finish(db, claim, false, null, errorCode, response.status === 429 || response.status >= 500);
    return response.status === 429 || response.status >= 500 ? "retry" : "failed";
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
