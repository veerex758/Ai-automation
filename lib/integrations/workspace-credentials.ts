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
  // The host allowlist is server policy, not a credential. Provider secrets must be
  // explicitly connected to this workspace; never silently fall back to a shared key.
  if (!credentials.http && process.env.AIVANTA_HTTP_ALLOWED_HOSTS) {
    credentials.http = { allowedHosts: process.env.AIVANTA_HTTP_ALLOWED_HOSTS, apiKeys: "{}" };
  }
  return credentials;
}
