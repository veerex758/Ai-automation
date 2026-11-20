import { createHash } from "node:crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { after, NextResponse, type NextRequest } from "next/server";
import { runDurableWorker } from "@/lib/workflows/durable-worker";
import { decryptWebhookSecret } from "@/lib/webhooks/secret-crypto";
import { verifyWebhookSignature } from "@/lib/webhooks/verify-signature";
import { validateDurableLiveSteps } from "@/lib/workflows/durable-worker";
import { validateRegisteredSteps } from "@/nodes/validate-steps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 256 * 1024;
const MAX_EVENT_AGE_SECONDS = 300;

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.CODED_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.CODED_SUPABASE_SERVICE_ROLE_KEY ?? process.env.CODED_SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("WEBHOOK_SERVICE_DATABASE_NOT_CONFIGURED");
  return createSupabaseClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function readBoundedBody(request: NextRequest): Promise<Buffer | null> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_BODY_BYTES)) return null;
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

function ciphertextBytes(value: unknown): Buffer {
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "string" && value.startsWith("\\x")) return Buffer.from(value.slice(2), "hex");
  if (typeof value === "string") return Buffer.from(value, "base64");
  throw new Error("WEBHOOK_SECRET_CIPHERTEXT_INVALID");
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest, context: { params: Promise<{ endpointKey: string }> }) {
  let receipt: { id: string } | null = null;
  let db: ReturnType<typeof serviceClient> | null = null;
  try {
    const { endpointKey } = await context.params;
    if (typeof endpointKey !== "string" || endpointKey.length < 32 || endpointKey.length > 256) {
      return jsonError("Invalid webhook endpoint.", 404);
    }

    const rawBody = await readBoundedBody(request);
    if (!rawBody) return jsonError("Webhook payload exceeds the 256 KiB limit.", 413);
    const eventId = request.headers.get("x-aivanta-event-id")?.trim() ?? "";
    const eventType = request.headers.get("x-aivanta-event-type")?.trim() ?? "";
    const signatureHeader = request.headers.get("x-aivanta-signature");
    if (!eventId || eventId.length > 200 || !eventType || eventType.length > 100) {
      return jsonError("Valid X-Aivanta-Event-Id and X-Aivanta-Event-Type headers are required.", 400);
    }

    let payloadValue: unknown;
    try { payloadValue = JSON.parse(rawBody.toString("utf8")); } catch {
      return jsonError("Webhook payload must be valid JSON.", 400);
    }
    if (!payloadValue || typeof payloadValue !== "object" || Array.isArray(payloadValue)) {
      return jsonError("Webhook payload must be a JSON object.", 400);
    }

    const endpointHash = createHash("sha256").update(endpointKey, "utf8").digest("hex");
    db = serviceClient();
    const { data: endpoint, error: endpointError } = await db.from("webhook_endpoints")
      .select("id,workspace_id,workflow_id,secret_ciphertext,secret_key_version,status")
      .eq("endpoint_key_hash", endpointHash).maybeSingle();
    if (endpointError) throw endpointError;
    if (!endpoint || endpoint.status !== "active") return jsonError("Webhook endpoint not found or disabled.", 404);

    const encryptionKey = process.env.AIVANTA_WEBHOOK_ENCRYPTION_KEY;
    const configuredKeyVersion = process.env.AIVANTA_WEBHOOK_SECRET_KEY_VERSION;
    if (!encryptionKey || !configuredKeyVersion || endpoint.secret_key_version !== configuredKeyVersion) {
      return jsonError("Webhook endpoint is not configured for secure verification.", 503);
    }
    let signingSecret: string;
    try { signingSecret = decryptWebhookSecret(ciphertextBytes(endpoint.secret_ciphertext), encryptionKey); }
    catch { return jsonError("Webhook endpoint is not configured for secure verification.", 503); }
    const verification = verifyWebhookSignature({
      rawBody, signedMetadata: JSON.stringify([eventId, eventType]), signatureHeader,
      secret: signingSecret, toleranceSeconds: MAX_EVENT_AGE_SECONDS,
    });
    signingSecret = "";
    if (!verification.ok) return jsonError("Webhook signature is missing, invalid, or stale.", 401);

    const { data: workflow, error: workflowError } = await db.from("workflows")
      .select("id,workspace_id,version,definition,status")
      .eq("id", endpoint.workflow_id).eq("workspace_id", endpoint.workspace_id).maybeSingle();
    if (workflowError) throw workflowError;
    if (!workflow || workflow.status !== "active") return jsonError("The linked workflow is not active.", 409);
    if (process.env.AIVANTA_LIVE_EXECUTION_ENABLED !== "true" ||
        process.env.AIVANTA_DURABLE_WEBHOOK_LIVE_ENABLED !== "true") {
      return jsonError("Durable live webhook execution is disabled by the server.", 503);
    }

    const definition = workflow.definition as { format?: unknown; steps?: unknown } | null;
    if (!definition || definition.format !== "aivanta-registry-v1") {
      return jsonError("The linked workflow does not have a supported registry execution plan.", 422);
    }
    const validated = validateRegisteredSteps(definition.steps);
    if (!validated.steps) return jsonError(validated.error || "The linked workflow execution plan is invalid.", 422);
    const steps = validated.steps;
    const trigger = steps[0];
    if (trigger.kind !== "trigger" || trigger.nodeId !== "webhooks" || trigger.operationId !== "receive_event") {
      return jsonError("The linked workflow must start with the verified webhook trigger.", 422);
    }
    const livePolicyError = validateDurableLiveSteps(steps);
    if (livePolicyError) return jsonError("This workflow is not approved for live webhook execution.", 403);

    const hourAgo = new Date(Date.now() - 3600000).toISOString();
    const { count: hourlyRuns, error: usageError } = await db.from("workflow_runs")
      .select("id", { count: "exact", head: true })
      .eq("workflow_id", workflow.id).eq("mode", "live").gte("created_at", hourAgo);
    if (usageError) throw usageError;
    if ((hourlyRuns ?? 0) >= 100) return jsonError("This workflow reached its hourly usage limit. Try again later.", 429);

    const eventInput = { eventId, eventType, receivedAt: new Date().toISOString(), payload: payloadValue };
    if (Buffer.byteLength(JSON.stringify(eventInput), "utf8") > 12000) {
      return jsonError("Webhook payload exceeds the 12 KiB durable queue limit.", 413);
    }
    const payloadSha256 = createHash("sha256").update(rawBody).digest("hex");
    const { data: claimRows, error: claimError } = await db.rpc("claim_webhook_event", {
      target_endpoint_id: endpoint.id, target_event_id: eventId,
      target_event_type: eventType, target_payload_sha256: payloadSha256,
    });
    if (claimError) throw claimError;
    const claim = Array.isArray(claimRows) ? claimRows[0] : claimRows;
    if (!claim || typeof claim.accepted !== "boolean" || typeof claim.receipt_id !== "string") {
      throw new Error("WEBHOOK_RECEIPT_CLAIM_FAILED");
    }
    receipt = { id: claim.receipt_id };
    if (!claim.accepted) {
      const { data: prior, error: priorError } = await db.from("webhook_event_receipts")
        .select("payload_sha256").eq("id", claim.receipt_id).maybeSingle();
      if (priorError) throw priorError;
      if (prior && prior.payload_sha256 !== payloadSha256) {
        return jsonError("This event ID was already used for a different payload.", 409);
      }
    }

    const eventKey = createHash("sha256").update(eventId).digest("hex").slice(0, 48);
    const { data: dispatch, error: dispatchError } = await db.rpc("dispatch_workflow_execution", {
      p_workspace_id: workflow.workspace_id,
      p_workflow_id: workflow.id,
      p_workflow_version: workflow.version,
      p_created_by: null,
      p_idempotency_key: "webhook:" + endpoint.id + ":" + eventKey,
      p_payload: { input: eventInput, source: "webhook", webhookVerified: true, endpointId: endpoint.id, payloadSha256 },
      p_max_attempts: 1,
      p_execution_mode: "live",
    });
    const queued = dispatch as Record<string, unknown> | null;
    if (dispatchError || !queued || typeof queued.job_id !== "string" || typeof queued.run_id !== "string") {
      throw new Error("WEBHOOK_QUEUE_DISPATCH_FAILED");
    }

    const { error: receiptError } = await db.from("webhook_event_receipts").update({
      status: "dispatched", dispatched_at: new Date().toISOString(), failure_code: null,
    }).eq("id", receipt.id);
    if (receiptError) throw new Error("WEBHOOK_RECEIPT_UPDATE_FAILED");

    after(async () => {
      try { await runDurableWorker(); }
      catch (error) {
        console.error("[webhook-ingress] durable worker wake failed", {
          code: error instanceof Error && /^[A-Z0-9_]{1,64}$/.test(error.message) ? error.message : "WORKER_WAKE_FAILED",
        });
      }
    });

    return NextResponse.json({
      accepted: true, queued: true, duplicate: !claim.accepted,
      jobId: queued.job_id, runId: queued.run_id, mode: "live",
    }, { status: 202 });
  } catch (error) {
    console.error("[webhook-ingress] event queue failed", {
      receiptId: receipt?.id ?? null,
      code: error instanceof Error ? error.message : "WEBHOOK_QUEUE_DISPATCH_FAILED",
    });
    if (db && receipt) {
      await db.from("webhook_event_receipts").update({
        status: "failed", failure_code: "WEBHOOK_QUEUE_DISPATCH_FAILED",
      }).eq("id", receipt.id);
    }
    return jsonError("Webhook could not be queued. Check workflow run history before retrying.", 500);
  }
}
