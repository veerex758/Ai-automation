import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptCredentials, encryptCredentials, isCredentialEncryptionConfigured } from "@/lib/integrations/credential-crypto";
import { safeHttpsRequest } from "@/lib/workflows/safe-http-transport";

export const dynamic = "force-dynamic";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const providers = ["openai", "gemini", "resend", "slack", "http"] as const;
type Provider = typeof providers[number];
type Credentials = Record<string, string>;
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));

async function authorizedWorkflow(workflowId: string) {
  if (!uuid.test(workflowId)) return { response: NextResponse.json({ error: "Invalid workflow ID." }, { status: 400 }) };
  const userClient = await createClient();
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return { response: NextResponse.json({ error: "Authentication required." }, { status: 401 }) };
  const { data: workflow, error } = await userClient.from("workflows").select("id,workspace_id").eq("id", workflowId).maybeSingle();
  if (error) throw error;
  if (!workflow) return { response: NextResponse.json({ error: "Workflow not found or access denied." }, { status: 404 }) };
  return { userClient, user, workflow };
}

function validateCredentials(provider: Provider, value: unknown): { credentials: Credentials; metadata: Record<string, unknown>; displayName: string } {
  if (!isRecord(value)) throw new Error("CONNECTION_FIELDS_INVALID");
  const stringField = (key: string, max = 4096) => {
    const field = value[key];
    if (typeof field !== "string" || !field.trim() || field.length > max) throw new Error("CONNECTION_FIELDS_INVALID");
    return field.trim();
  };
  if (provider === "openai" || provider === "gemini") {
    return { credentials: { apiKey: stringField("apiKey", 512) }, metadata: {}, displayName: provider === "openai" ? "OpenAI" : "Google Gemini" };
  }
  if (provider === "resend") {
    const fromEmail = stringField("fromEmail", 254);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail) && !/^.+<[^\s@]+@[^\s@]+\.[^\s@]+>$/.test(fromEmail)) throw new Error("CONNECTION_SENDER_INVALID");
    return { credentials: { apiKey: stringField("apiKey", 512), fromEmail }, metadata: { senderConfigured: true }, displayName: "Resend Email" };
  }
  if (provider === "slack") {
    const webhookUrl = stringField("webhookUrl", 2048);
    let url: URL;
    try { url = new URL(webhookUrl); } catch { throw new Error("CONNECTION_WEBHOOK_INVALID"); }
    if (url.protocol !== "https:" || url.hostname !== "hooks.slack.com" || !url.pathname.startsWith("/services/") || url.username || url.password) throw new Error("CONNECTION_WEBHOOK_INVALID");
    return { credentials: { webhookUrl: url.toString() }, metadata: {}, displayName: "Slack Incoming Webhook" };
  }
  const host = stringField("host", 253).toLowerCase().replace(/\.$/, "");
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host) || host === "localhost" || host.endsWith(".local")) throw new Error("CONNECTION_HOST_INVALID");
  return { credentials: { apiKey: stringField("apiKey", 4096) }, metadata: { host }, displayName: "HTTP API · " + host };
}

async function testProvider(provider: Provider, credentials: Credentials, metadata: Record<string, unknown>, confirmSlackDelivery = false) {
  if (provider === "openai") {
    const result = await safeHttpsRequest({ url: "https://api.openai.com/v1/models/gpt-4o-mini", method: "GET", headers: { Authorization: "Bearer " + credentials.apiKey }, timeoutMs: 8000, maxResponseBytes: 32768 });
    if (result.status < 200 || result.status >= 300) throw new Error(result.status === 401 ? "CONNECTION_AUTH_FAILED" : "CONNECTION_TEST_FAILED");
    return;
  }
  if (provider === "gemini") {
    const result = await safeHttpsRequest({ url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash", method: "GET", headers: { "x-goog-api-key": credentials.apiKey }, timeoutMs: 8000, maxResponseBytes: 32768 });
    if (result.status < 200 || result.status >= 300) throw new Error(result.status === 401 || result.status === 403 ? "CONNECTION_AUTH_FAILED" : "CONNECTION_TEST_FAILED");
    return;
  }
  if (provider === "resend") {
    const result = await safeHttpsRequest({ url: "https://api.resend.com/domains", method: "GET", headers: { Authorization: "Bearer " + credentials.apiKey }, timeoutMs: 8000, maxResponseBytes: 32768 });
    if (result.status < 200 || result.status >= 300) throw new Error(result.status === 401 || result.status === 403 ? "CONNECTION_AUTH_FAILED" : "CONNECTION_TEST_FAILED");
    return;
  }
  if (provider === "slack") {
    const url = new URL(credentials.webhookUrl);
    if (url.protocol !== "https:" || url.hostname !== "hooks.slack.com" || !url.pathname.startsWith("/services/")) {
      throw new Error("CONNECTION_WEBHOOK_INVALID");
    }
    if (!confirmSlackDelivery) return;
    // This branch is reached only after the user explicitly confirms the test-message action.
    const result = await safeHttpsRequest({
      url: url.toString(),
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: { text: "Aivanta connection test: this workspace successfully delivered a test message to Slack." },
      timeoutMs: 8000,
      maxResponseBytes: 2048,
    });
    if (result.status < 200 || result.status >= 300 || result.body !== "ok") {
      throw new Error("CONNECTION_TEST_FAILED");
    }
    return;
  }
  const host = metadata.host;
  if (typeof host !== "string") throw new Error("CONNECTION_HOST_INVALID");
  // Validate the credential against a side-effect-free HTTPS endpoint. The host must also
  // be included in the server-side AIVANTA_HTTP_ALLOWED_HOSTS policy before workflow use.
  const allowedHosts = (process.env.AIVANTA_HTTP_ALLOWED_HOSTS ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (!allowedHosts.includes(host)) throw new Error("HTTP_HOST_NOT_SERVER_ALLOWLISTED");
  const result = await safeHttpsRequest({ url: "https://" + host + "/", method: "GET", headers: { Authorization: "Bearer " + credentials.apiKey }, timeoutMs: 8000, maxResponseBytes: 8192 });
  if (result.status === 401 || result.status === 403) throw new Error("CONNECTION_AUTH_FAILED");
  if (result.status >= 500) throw new Error("CONNECTION_TEST_FAILED");
}

async function loadSecret(admin: ReturnType<typeof createAdminClient>, integrationId: string) {
  const { data, error } = await admin.from("workspace_integration_secrets").select("encrypted_credentials").eq("integration_id", integrationId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("CONNECTION_SECRET_MISSING");
  return decryptCredentials(data.encrypted_credentials);
}

export async function GET(_request: NextRequest, context: { params: Promise<{ workflowId: string }> }) {
  try {
    const { workflowId } = await context.params;
    const auth = await authorizedWorkflow(workflowId);
    if ("response" in auth) return auth.response;
    const { data, error } = await auth.userClient.from("workspace_integrations")
      .select("provider,status,display_name,metadata,last_tested_at,last_test_status,updated_at")
      .eq("workspace_id", auth.workflow.workspace_id).order("provider");
    if (error) throw error;
    return NextResponse.json({ integrations: data ?? [], encryptionConfigured: isCredentialEncryptionConfigured() }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load workspace integrations." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, context: { params: Promise<{ workflowId: string }> }) {
  try {
    const { workflowId } = await context.params;
    const auth = await authorizedWorkflow(workflowId);
    if ("response" in auth) return auth.response;
    if (!process.env.AIVANTA_CREDENTIALS_ENCRYPTION_KEY) return NextResponse.json({ error: "Credential encryption is not configured on the server. Set AIVANTA_CREDENTIALS_ENCRYPTION_KEY before connecting apps." }, { status: 503 });
    let body: unknown;
    try { body = await request.json(); } catch { return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 }); }
    if (!isRecord(body) || typeof body.provider !== "string" || !providers.includes(body.provider as Provider)) return NextResponse.json({ error: "Unsupported integration provider." }, { status: 400 });
    const provider = body.provider as Provider;
    const validated = validateCredentials(provider, body.credentials);
    // Validate key material before mutating metadata so a bad key cannot leave an orphan connection.
    const encrypted = encryptCredentials(validated.credentials);
    const admin = createAdminClient();
    const { data: existing, error: existingError } = await auth.userClient.from("workspace_integrations")
      .select("id,status,display_name,metadata,last_test_status,last_tested_at")
      .eq("workspace_id", auth.workflow.workspace_id).eq("provider", provider).maybeSingle();
    if (existingError) throw existingError;
    let integrationId: string;
    if (existing?.id) {
      integrationId = existing.id;
      const { data: updated, error } = await auth.userClient.from("workspace_integrations").update({
        status: "needs_attention", display_name: validated.displayName, metadata: validated.metadata,
        last_test_status: null, last_tested_at: null,
      }).eq("id", integrationId).eq("workspace_id", auth.workflow.workspace_id).select("id").maybeSingle();
      if (error) throw error;
      if (!updated) throw new Error("INTEGRATION_MANAGE_PERMISSION_REQUIRED");
    } else {
      const { data, error } = await auth.userClient.from("workspace_integrations").insert({
        workspace_id: auth.workflow.workspace_id, provider, status: "needs_attention", display_name: validated.displayName,
        metadata: validated.metadata, created_by: auth.user.id,
      }).select("id").single();
      if (error) throw error;
      integrationId = data.id;
    }
    const { error: secretError } = await admin.from("workspace_integration_secrets").upsert({
      integration_id: integrationId, encrypted_credentials: encrypted, encryption_version: "v1", updated_at: new Date().toISOString(),
    }, { onConflict: "integration_id" });
    if (secretError) {
      // Metadata and encrypted credentials live in separate tables. Restore the previous
      // metadata (or remove the new metadata row) if the secret write fails, so the API
      // never reports a partially-saved connection.
      if (existing) {
        const { error: rollbackError } = await auth.userClient.from("workspace_integrations").update({
          status: existing.status,
          display_name: existing.display_name,
          metadata: existing.metadata,
          last_test_status: existing.last_test_status,
          last_tested_at: existing.last_tested_at,
        }).eq("id", integrationId).eq("workspace_id", auth.workflow.workspace_id);
        if (rollbackError) {
          console.error("Integration metadata rollback failed after credential write failure.", { provider, integrationId });
        }
      } else {
        const { error: rollbackError } = await auth.userClient.from("workspace_integrations").delete()
          .eq("id", integrationId).eq("workspace_id", auth.workflow.workspace_id);
        if (rollbackError) {
          console.error("New integration metadata cleanup failed after credential write failure.", { provider, integrationId });
        }
      }
      throw secretError;
    }
    return NextResponse.json({ saved: true, provider, status: "needs_attention", displayName: validated.displayName, tested: false, secretReturned: false }, { status: 200, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const status = code === "CONNECTION_FIELDS_INVALID" || code === "CONNECTION_SENDER_INVALID" || code === "CONNECTION_WEBHOOK_INVALID" || code === "CONNECTION_HOST_INVALID" ? 400 :
      code === "CREDENTIALS_ENCRYPTION_KEY_MISSING" || code === "CREDENTIALS_ENCRYPTION_KEY_INVALID" || code === "SUPABASE_ADMIN_NOT_CONFIGURED" ? 503 : 500;
    return NextResponse.json({ error: status === 400 || status === 503 ? code : "Could not save this integration securely." }, { status });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ workflowId: string }> }) {
  try {
    const { workflowId } = await context.params;
    const auth = await authorizedWorkflow(workflowId);
    if ("response" in auth) return auth.response;
    let body: unknown;
    try { body = await request.json(); } catch { return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 }); }
    if (!isRecord(body) || typeof body.provider !== "string" || !providers.includes(body.provider as Provider)) return NextResponse.json({ error: "Unsupported integration provider." }, { status: 400 });
    const provider = body.provider as Provider;
    if (provider === "slack" && body.confirmSlackDelivery !== undefined && typeof body.confirmSlackDelivery !== "boolean") {
      return NextResponse.json({ error: "Invalid Slack delivery confirmation." }, { status: 400 });
    }
    const confirmSlackDelivery = provider === "slack" && body.confirmSlackDelivery === true;
    const { data: integration, error } = await auth.userClient.from("workspace_integrations")
      .select("id,metadata").eq("workspace_id", auth.workflow.workspace_id).eq("provider", provider).maybeSingle();
    if (error) throw error;
    if (!integration) return NextResponse.json({ error: "Connect this integration first." }, { status: 404 });
    // Check workspace-owner/admin write permission before decrypting credentials or sending Slack.
    // This avoids privileged secret reads for users who cannot manage the integration.
    if (provider === "slack" && confirmSlackDelivery) {
      const { data: permissionCheck, error: permissionError } = await auth.userClient.from("workspace_integrations").update({
        status: "needs_attention", last_tested_at: null, last_test_status: null,
      }).eq("id", integration.id).eq("workspace_id", auth.workflow.workspace_id).select("id").maybeSingle();
      if (permissionError || !permissionCheck) throw new Error("INTEGRATION_MANAGE_PERMISSION_REQUIRED");
    }
    const admin = createAdminClient();
    const credentials = await loadSecret(admin, integration.id);
    try {
      await testProvider(provider, credentials, (integration.metadata ?? {}) as Record<string, unknown>, confirmSlackDelivery);
    } catch (testError) {
      const { error: updateError } = await auth.userClient.from("workspace_integrations").update({
        status: "needs_attention", last_tested_at: new Date().toISOString(), last_test_status: "failed",
      }).eq("id", integration.id).eq("workspace_id", auth.workflow.workspace_id);
      if (updateError) throw updateError;
      throw testError;
    }
    if (provider === "slack" && !confirmSlackDelivery) {
      // URL syntax validation is deliberately non-delivering and cannot mark Slack connected.
      const { error: updateError } = await auth.userClient.from("workspace_integrations").update({
        status: "needs_attention", last_tested_at: null, last_test_status: null,
      }).eq("id", integration.id).eq("workspace_id", auth.workflow.workspace_id);
      if (updateError) throw updateError;
      return NextResponse.json({
        tested: false,
        provider,
        status: "needs_attention",
        note: "Webhook URL format is valid, but delivery is unverified. No Slack message was sent. Use the explicitly labelled Send test message action to verify delivery.",
      }, { headers: { "Cache-Control": "private, no-store" } });
    }

    const now = new Date().toISOString();
    const { error: updateError } = await auth.userClient.from("workspace_integrations").update({ status: "connected", last_tested_at: now, last_test_status: "passed" })
      .eq("id", integration.id).eq("workspace_id", auth.workflow.workspace_id);
    if (updateError) throw updateError;
    return NextResponse.json({ tested: true, provider, status: "passed", note: provider === "http" ? "The HTTPS host responded; this does not prove every API route or scope is authorized." : "Provider accepted the connection check." }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "INTEGRATION_MANAGE_PERMISSION_REQUIRED") {
      return NextResponse.json({ error: "Only workspace owners and admins can verify or manage integrations." }, { status: 403 });
    }
    return NextResponse.json({ error: code.startsWith("CONNECTION_") || code.startsWith("HTTP_HOST_") ? code : "Integration test failed. Check the provider key and permissions." }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ workflowId: string }> }) {
  try {
    const { workflowId } = await context.params;
    const auth = await authorizedWorkflow(workflowId);
    if ("response" in auth) return auth.response;
    const provider = new URL(request.url).searchParams.get("provider") as Provider | null;
    if (!provider || !providers.includes(provider)) return NextResponse.json({ error: "Provide a supported provider." }, { status: 400 });
    const { error } = await auth.userClient.from("workspace_integrations").delete().eq("workspace_id", auth.workflow.workspace_id).eq("provider", provider);
    if (error) throw error;
    return NextResponse.json({ disconnected: true, provider });
  } catch {
    return NextResponse.json({ error: "Could not disconnect this integration." }, { status: 500 });
  }
}
