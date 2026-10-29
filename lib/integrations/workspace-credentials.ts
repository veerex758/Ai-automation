import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptCredentials } from "@/lib/integrations/credential-crypto";

export type RuntimeCredentials = Readonly<Record<string, Readonly<Record<string, string>>>>;

export async function loadWorkspaceCredentials(workspaceId: string): Promise<RuntimeCredentials> {
  const admin = createAdminClient();
  const { data: integrations, error } = await admin.from("workspace_integrations")
    .select("id,provider,metadata")
    .eq("workspace_id", workspaceId);
  if (error) throw new Error("WORKSPACE_CONNECTIONS_LOAD_FAILED");
  const credentials: Record<string, Record<string, string>> = {};
  for (const integration of integrations ?? []) {
    const { data: secret, error: secretError } = await admin.from("workspace_integration_secrets")
      .select("encrypted_credentials").eq("integration_id", integration.id).maybeSingle();
    if (secretError || !secret) throw new Error("WORKSPACE_CONNECTION_SECRET_UNAVAILABLE");
    const decrypted = decryptCredentials(secret.encrypted_credentials);
    if (integration.provider === "openai") credentials.openai = { apiKey: decrypted.apiKey };
    else if (integration.provider === "gemini") credentials.gemini = { apiKey: decrypted.apiKey };
    else if (integration.provider === "resend") credentials.resend = { apiKey: decrypted.apiKey, fromEmail: decrypted.fromEmail };
    else if (integration.provider === "slack") credentials.slack = { webhookUrl: decrypted.webhookUrl };
    else if (integration.provider === "http") {
      const host = (integration.metadata as Record<string, unknown> | null)?.host;
      const allowedHosts = (process.env.AIVANTA_HTTP_ALLOWED_HOSTS ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
      if (typeof host === "string" && allowedHosts.includes(host)) {
        credentials.http = { allowedHosts: host, apiKeys: JSON.stringify({ [host]: decrypted.apiKey }) };
      }
    }
  }
  // Backward-compatible server-managed credentials are used only when a workspace
  // has not explicitly connected that provider. No credential is ever returned to the browser.
  if (!credentials.openai && process.env.OPENAI_API_KEY) credentials.openai = { apiKey: process.env.OPENAI_API_KEY };
  if (!credentials.slack && process.env.SLACK_INCOMING_WEBHOOK_URL) credentials.slack = { webhookUrl: process.env.SLACK_INCOMING_WEBHOOK_URL };
  if (!credentials.resend && process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL) {
    credentials.resend = { apiKey: process.env.RESEND_API_KEY, fromEmail: process.env.RESEND_FROM_EMAIL };
  }
  if (!credentials.http && process.env.AIVANTA_HTTP_ALLOWED_HOSTS) {
    credentials.http = { allowedHosts: process.env.AIVANTA_HTTP_ALLOWED_HOSTS, apiKeys: process.env.AIVANTA_HTTP_API_KEYS ?? "{}" };
  }
  return credentials;
}
