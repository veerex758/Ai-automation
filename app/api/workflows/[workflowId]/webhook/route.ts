import { randomBytes, createHash } from "node:crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encryptWebhookSecret } from "@/lib/webhooks/secret-crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest, context: { params: Promise<{ workflowId: string }> }) {
  try {
    const { workflowId } = await context.params;
    if (!UUID.test(workflowId)) return jsonError("Invalid workflow ID.", 400);

    const userClient = await createClient();
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return jsonError("Authentication required.", 401);

    let body: unknown;
    try { body = await request.json(); } catch { return jsonError("Request body must be valid JSON.", 400); }
    if (!isRecord(body) || body.confirm !== true) {
      return jsonError("Set confirm to true to create and activate an inbound webhook endpoint.", 400);
    }

    const { data: workflow, error: workflowError } = await userClient.from("workflows")
      .select("id,workspace_id,status,definition").eq("id", workflowId).maybeSingle();
    if (workflowError) throw workflowError;
    if (!workflow || workflow.status !== "active") {
      return jsonError("Only an active workflow you can access can receive webhook events.", 409);
    }

    const definition = workflow.definition as { format?: unknown; steps?: unknown } | null;
    if (!definition || definition.format !== "aivanta-registry-v1" ||
        !Array.isArray(definition.steps) || definition.steps.length < 1 || definition.steps.length > 30) {
      return jsonError("Save a supported registry workflow before provisioning a webhook.", 422);
    }
    const steps = definition.steps as Array<Record<string, unknown>>;
    if (steps[0]?.kind !== "trigger" || steps[0]?.nodeId !== "webhooks" ||
        steps[0]?.operationId !== "receive_event" ||
        steps.filter((step) => step?.kind === "trigger").length !== 1) {
      return jsonError("The workflow must begin with the verified webhook trigger.", 422);
    }

    const encryptionKey = process.env.AIVANTA_WEBHOOK_ENCRYPTION_KEY;
    const keyVersion = process.env.AIVANTA_WEBHOOK_SECRET_KEY_VERSION;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!encryptionKey || !keyVersion || !serviceRoleKey || !supabaseUrl) {
      return jsonError("Secure webhook provisioning is not configured on this environment.", 503);
    }

    const endpointKey = randomBytes(32).toString("base64url");
    const signingSecret = randomBytes(32).toString("hex");
    const encryptedSecret = encryptWebhookSecret(signingSecret, encryptionKey);
    const serviceClient = createSupabaseClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: endpoint, error: insertError } = await serviceClient.from("webhook_endpoints").insert({
      workspace_id: workflow.workspace_id,
      workflow_id: workflow.id,
      endpoint_key_hash: createHash("sha256").update(endpointKey, "utf8").digest("hex"),
      secret_ciphertext: "\\x" + encryptedSecret.toString("hex"),
      secret_key_version: keyVersion,
      status: "active",
      created_by: user.id,
    }).select("id,created_at,status").single();
    if (insertError) {
      if (insertError.code === "23505") {
        return jsonError("This workflow already has a webhook endpoint. Revoke the existing endpoint before replacing it.", 409);
      }
      throw insertError;
    }

    return NextResponse.json({
      endpoint: {
        id: endpoint.id,
        status: endpoint.status,
        createdAt: endpoint.created_at,
        path: "/api/webhooks/" + endpointKey,
      },
      signingSecret,
      secretShownOnce: true,
      signature: {
        header: "X-Aivanta-Signature",
        format: "t=<unix-seconds>,v1=<hex HMAC-SHA256>",
        signedMessage: "timestamp + '.' + exact raw request body bytes",
        eventIdHeader: "X-Aivanta-Event-Id",
        eventTypeHeader: "X-Aivanta-Event-Type",
      },
    }, { status: 201 });
  } catch (error) {
    console.error("[webhook-provisioning] failed", {
      code: error instanceof Error ? error.message : "WEBHOOK_PROVISIONING_FAILED",
    });
    return jsonError("Could not provision webhook endpoint.", 500);
  }
}


export async function DELETE(_request: NextRequest, context: { params: Promise<{ workflowId: string }> }) {
  try {
    const { workflowId } = await context.params;
    if (!UUID.test(workflowId)) return jsonError("Invalid workflow ID.", 400);
    const userClient = await createClient();
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return jsonError("Authentication required.", 401);

    const { data: workflow, error: workflowError } = await userClient.from("workflows")
      .select("id,workspace_id").eq("id", workflowId).maybeSingle();
    if (workflowError) throw workflowError;
    if (!workflow) return jsonError("Workflow not found or you do not have access to it.", 404);

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!serviceRoleKey || !supabaseUrl) return jsonError("Secure webhook provisioning is not configured on this environment.", 503);
    const serviceClient = createSupabaseClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await serviceClient.from("webhook_endpoints")
      .update({ status: "revoked" })
      .eq("workflow_id", workflow.id)
      .eq("workspace_id", workflow.workspace_id)
      .in("status", ["active", "disabled"])
      .select("id,status");
    if (error) throw error;
    return NextResponse.json({ revoked: data?.length ?? 0 });
  } catch (error) {
    console.error("[webhook-provisioning] revoke failed", {
      code: error instanceof Error ? error.message : "WEBHOOK_REVOKE_FAILED",
    });
    return jsonError("Could not revoke webhook endpoint.", 500);
  }
}
