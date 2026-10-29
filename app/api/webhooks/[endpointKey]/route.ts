import { createHash } from "node:crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { decryptWebhookSecret } from "@/lib/webhooks/secret-crypto";
import { verifyWebhookSignature } from "@/lib/webhooks/verify-signature";
import { executeRegisteredWorkflow, type RegisteredWorkflowStep } from "@/nodes/workflow-runner";
import type { NodeContext } from "@/nodes/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 256 * 1024;
const MAX_EVENT_AGE_SECONDS = 300;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
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

function executionContext(): Omit<NodeContext, "previousOutputs"> {
  const credentials: Record<string, Record<string, string>> = {};
  if (process.env.OPENAI_API_KEY) credentials.openai = { apiKey: process.env.OPENAI_API_KEY };
  if (process.env.SLACK_INCOMING_WEBHOOK_URL) credentials.slack = { webhookUrl: process.env.SLACK_INCOMING_WEBHOOK_URL };
  if (process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL) {
    credentials.resend = { apiKey: process.env.RESEND_API_KEY, fromEmail: process.env.RESEND_FROM_EMAIL };
  }
  return {
    credentials,
    logger: {
      info(message, meta) { console.info("[webhook-node]", message, meta ?? {}); },
      error(message, meta) { console.error("[webhook-node]", message, meta ?? {}); },
    },
    http: {
      async request(args) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), args.timeoutMs ?? 15000);
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
          try { body = raw ? JSON.parse(raw) : raw; } catch { body = raw; }
          return { status: response.status, body };
        } finally {
          clearTimeout(timer);
        }
      },
    },
  };
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest, context: { params: Promise<{ endpointKey: string }> }) {
  const startedAt = Date.now();
  let receipt: { id: string; endpoint_id: string } | null = null;
  let runId: string | null = null;
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
    if (!isRecord(payloadValue)) return jsonError("Webhook payload must be a JSON object.", 400);

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
      console.error("[webhook-ingress] secret decryption configuration unavailable", { endpointId: endpoint.id });
      return jsonError("Webhook endpoint is not configured for secure verification.", 503);
    }

    let signingSecret: string;
    try {
      signingSecret = decryptWebhookSecret(ciphertextBytes(endpoint.secret_ciphertext), encryptionKey);
    } catch {
      console.error("[webhook-ingress] stored signing secret could not be decrypted", { endpointId: endpoint.id });
      return jsonError("Webhook endpoint is not configured for secure verification.", 503);
    }
    const verification = verifyWebhookSignature({
      rawBody,
      signatureHeader,
      secret: signingSecret,
      signedMetadata: JSON.stringify([eventId, eventType]),
      toleranceSeconds: MAX_EVENT_AGE_SECONDS,
    });
    signingSecret = "";
    if (!verification.ok) {
      return jsonError("Webhook signature is missing, invalid, or stale.", 401);
    }

    const { data: workflow, error: workflowError } = await db.from("workflows")
      .select("id,workspace_id,version,definition,status")
      .eq("id", endpoint.workflow_id).eq("workspace_id", endpoint.workspace_id).maybeSingle();
    if (workflowError) throw workflowError;
    if (!workflow || workflow.status !== "active") return jsonError("The linked workflow is not active.", 409);

    const definition = workflow.definition as { format?: unknown; steps?: unknown } | null;
    if (!definition || definition.format !== "aivanta-registry-v1" ||
        !Array.isArray(definition.steps) || definition.steps.length < 1 || definition.steps.length > 30) {
      return jsonError("The linked workflow does not have a supported registry execution plan.", 422);
    }
    const steps = definition.steps as RegisteredWorkflowStep[];
    if (steps.some((step) => !isRecord(step) || typeof step.id !== "string" ||
      typeof step.nodeId !== "string" || typeof step.operationId !== "string" ||
      (step.kind !== "trigger" && step.kind !== "action") || !("input" in step))) {
      return jsonError("The linked workflow execution plan is malformed.", 422);
    }
    const trigger = steps[0];
    if (trigger.kind !== "trigger" || trigger.nodeId !== "webhooks" || trigger.operationId !== "receive_event" ||
        steps.filter((step) => step.kind === "trigger").length !== 1) {
      return jsonError("The linked workflow must start with the verified webhook trigger.", 422);
    }

    // Inbound events must not bypass the same live-action policy as manual runs.
    const unsupportedLiveStep = steps.find((step) =>
      (step.kind === "trigger" && !(step.nodeId === "webhooks" && step.operationId === "receive_event")) ||
      (step.kind === "action" && !(step.nodeId === "email" && step.operationId === "send_email")));
    if (unsupportedLiveStep) return jsonError("This workflow contains an action that is not enabled for live webhook execution.", 403);
    if (steps.some((step) => step.kind === "action") && process.env.AIVANTA_LIVE_EXECUTION_ENABLED !== "true") {
      return jsonError("Live workflow execution is disabled by the server.", 503);
    }
    const allowedRecipients = new Set((process.env.AIVANTA_LIVE_EMAIL_RECIPIENTS ?? "")
      .split(",").map((item) => item.trim().toLowerCase()).filter(Boolean));
    for (const step of steps) {
      if (step.nodeId === "email" && step.operationId === "send_email") {
        const recipient = isRecord(step.input) && typeof step.input.to === "string" ? step.input.to.trim().toLowerCase() : "";
        if (!recipient || recipient.includes("{{") || !allowedRecipients.has(recipient)) {
          return jsonError("Webhook workflow email recipients must be literal addresses on the server allowlist.", 403);
        }
      }
    }

    const payloadSha256 = createHash("sha256").update(rawBody).digest("hex");
    const { data: claimRows, error: claimError } = await db.rpc("claim_webhook_event", {
      target_endpoint_id: endpoint.id,
      target_event_id: eventId,
      target_event_type: eventType,
      target_payload_sha256: payloadSha256,
    });
    if (claimError) throw claimError;
    const claim = Array.isArray(claimRows) ? claimRows[0] : claimRows;
    if (!claim || typeof claim.accepted !== "boolean" || typeof claim.receipt_id !== "string") {
      throw new Error("WEBHOOK_RECEIPT_CLAIM_FAILED");
    }
    if (!claim.accepted) {
      const { data: prior, error: priorError } = await db.from("webhook_event_receipts")
        .select("payload_sha256,event_type,status").eq("id", claim.receipt_id).maybeSingle();
      if (priorError) throw priorError;
      if (prior && (prior.payload_sha256 !== payloadSha256 || prior.event_type !== eventType)) {
        return jsonError("This event ID was already used for a different payload.", 409);
      }
      return NextResponse.json({ accepted: true, duplicate: true, receiptStatus: prior?.status ?? "accepted" }, { status: 200 });
    }
    receipt = { id: claim.receipt_id, endpoint_id: endpoint.id };

    const eventInput = {
      eventId,
      eventType,
      receivedAt: new Date().toISOString(),
      payload: payloadValue,
    };
    const executionSteps = steps.map((step, index) => index === 0 ? { ...step, input: eventInput } : step);
    const { data: run, error: runInsertError } = await db.from("workflow_runs").insert({
      workspace_id: workflow.workspace_id,
      workflow_id: workflow.id,
      workflow_version: workflow.version,
      mode: "live",
      status: "running",
      created_by: null,
      idempotency_key: "webhook:" + endpoint.id + ":" + eventId,
      started_at: new Date(startedAt).toISOString(),
      completed_at: new Date(startedAt).toISOString(),
      duration_ms: 0,
    }).select("id,mode,status,workflow_version,started_at").single();
    if (runInsertError) throw runInsertError;
    runId = run.id;

    const execution = await executeRegisteredWorkflow({
      steps: executionSteps,
      context: { ...executionContext(), webhook: { verified: true } },
      dryRun: false,
    });
    const rows = execution.steps.map((step, index) => ({
      run_id: run.id,
      workspace_id: workflow.workspace_id,
      step_id: step.stepId,
      position: index + 1,
      step_type: executionSteps[index]?.kind ?? "action",
      title: (executionSteps[index]?.nodeId + "." + executionSteps[index]?.operationId).slice(0, 80),
      status: step.status === "succeeded" ? "executed" : step.status,
      result: step.status === "failed"
        ? { error: step.error }
        : step.status === "succeeded" && executionSteps[index]?.kind === "trigger"
          ? { eventId, eventType, receivedAt: eventInput.receivedAt, payloadSha256 }
          : step.status === "succeeded" ? (step.output ?? {}) : { message: step.error ?? "Step skipped." },
    }));
    const finalStatus = execution.status === "succeeded" ? "succeeded" : "failed";
    const { error: stepsError } = await db.from("workflow_run_steps").insert(rows);
    if (stepsError) throw stepsError;
    const { data: finalizedRun, error: finalizeError } = await db.from("workflow_runs").update({
      status: finalStatus,
      completed_at: new Date().toISOString(),
      duration_ms: Math.min(600000, Date.now() - startedAt),
      error_message: finalStatus === "failed" ? "One or more webhook workflow steps failed." : null,
    }).eq("id", run.id).eq("status", "running")
      .select("id,mode,status,workflow_version,started_at,completed_at,duration_ms,error_message").single();
    if (finalizeError) throw finalizeError;

    const { error: receiptUpdateError } = await db.from("webhook_event_receipts").update({
      status: finalStatus === "succeeded" ? "dispatched" : "failed",
      dispatched_at: new Date().toISOString(),
      failure_code: finalStatus === "failed" ? "WEBHOOK_WORKFLOW_FAILED" : null,
    }).eq("id", receipt.id);
    if (receiptUpdateError) throw receiptUpdateError;

    return NextResponse.json({
      accepted: true,
      duplicate: false,
      run: finalizedRun,
      steps: rows,
      sideEffectsPerformed: rows.some((row) => row.step_type === "action" && row.status === "executed"),
    }, { status: 202 });
  } catch (error) {
    console.error("[webhook-ingress] event dispatch failed", {
      receiptId: receipt?.id ?? null,
      code: error instanceof Error ? error.message : "WEBHOOK_DISPATCH_FAILED",
    });
    if (db && runId) {
      await db.from("workflow_runs").update({
        status: "failed",
        completed_at: new Date().toISOString(),
        duration_ms: Math.min(600000, Date.now() - startedAt),
        error_message: "Webhook dispatch or history persistence failed; an external side effect may already have occurred.",
      }).eq("id", runId).eq("status", "running");
    }
    if (db && receipt) {
      await db.from("webhook_event_receipts").update({
        status: "failed",
        failure_code: "WEBHOOK_DISPATCH_FAILED",
      }).eq("id", receipt.id);
    }
    return jsonError("Webhook could not be dispatched. Check workflow run history before retrying.", 500);
  }
}
