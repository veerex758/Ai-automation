import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptCredentials } from "@/lib/integrations/credential-crypto";
import { decryptGoogleCredentials, encryptGoogleCredentials } from "@/lib/integrations/google-credentials";

async function loadGoogleProductCredential(admin: ReturnType<typeof createAdminClient>, workspaceId: string, product: "gmail" | "sheets") {
  const { data, error } = await admin.from("google_connections")
    .select("id,encrypted_credentials,scopes,status")
    .eq("workspace_id", workspaceId).eq("product", product).eq("status", "connected")
    .order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error("GOOGLE_CONNECTION_LOAD_FAILED");
  if (!data) return null;

  const requiredScope = product === "gmail"
    ? "https://www.googleapis.com/auth/gmail.readonly"
    : "https://www.googleapis.com/auth/spreadsheets.readonly";
  if (!Array.isArray(data.scopes) || !data.scopes.includes(requiredScope)) {
    await admin.from("google_connections").update({ status: "needs_reauth", updated_at: new Date().toISOString() }).eq("id", data.id);
    throw new Error(product === "gmail" ? "GMAIL_SCOPE_REAUTH_REQUIRED" : "SHEETS_SCOPE_REAUTH_REQUIRED");
  }

  let stored = decryptGoogleCredentials(data.encrypted_credentials);
  if (stored.expiry_date && stored.expiry_date <= Date.now() + 60_000) {
    if (!stored.refresh_token) {
      await admin.from("google_connections").update({ status: "needs_reauth", updated_at: new Date().toISOString() }).eq("id", data.id);
      throw new Error(product === "gmail" ? "GMAIL_REAUTH_REQUIRED" : "SHEETS_REAUTH_REQUIRED");
    }
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error("GOOGLE_OAUTH_NOT_CONFIGURED");
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: stored.refresh_token, grant_type: "refresh_token" }),
      cache: "no-store", signal: AbortSignal.timeout(10000),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok || !payload || typeof payload !== "object" || !("access_token" in payload) || typeof payload.access_token !== "string") {
      await admin.from("google_connections").update({ status: "needs_reauth", updated_at: new Date().toISOString() }).eq("id", data.id);
      throw new Error(product === "gmail" ? "GMAIL_REAUTH_REQUIRED" : "SHEETS_REAUTH_REQUIRED");
    }
    const refreshed = payload as Record<string, unknown>;
    stored = {
      ...stored,
      access_token: refreshed.access_token,
      ...(typeof refreshed.refresh_token === "string" ? { refresh_token: refreshed.refresh_token } : {}),
      ...(typeof refreshed.token_type === "string" ? { token_type: refreshed.token_type } : {}),
      ...(typeof refreshed.expires_in === "number" ? { expiry_date: Date.now() + refreshed.expires_in * 1000 } : {}),
    };
    const { error: updateError } = await admin.from("google_connections").update({
      encrypted_credentials: encryptGoogleCredentials(stored),
      expires_at: stored.expiry_date ? new Date(stored.expiry_date).toISOString() : null,
      status: "connected", updated_at: new Date().toISOString(),
    }).eq("id", data.id);
    if (updateError) throw new Error("GOOGLE_TOKEN_REFRESH_SAVE_FAILED");
  }
  return { accessToken: stored.access_token, account: "google" };
}

export type RuntimeCredentials = Readonly<Record<string, Readonly<Record<string, string>>>>;

export async function loadWorkspaceCredentials(workspaceId: string): Promise<RuntimeCredentials> {
  const admin = createAdminClient();
  const { data: integrations, error } = await admin.from("workspace_integrations")
    .select("id,provider,metadata,status")
    .eq("workspace_id", workspaceId);
  if (error) throw new Error("WORKSPACE_CONNECTIONS_LOAD_FAILED");
  const credentials: Record<string, Record<string, string>> = {};
  for (const integration of integrations ?? []) {
    if (integration.status !== "connected") continue;
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
  const gmail = await loadGoogleProductCredential(admin, workspaceId, "gmail");
  const sheets = await loadGoogleProductCredential(admin, workspaceId, "sheets");
  if (gmail) credentials.gmail = gmail;
  if (sheets) credentials.sheets = sheets;

  // The host allowlist is server policy, not a credential. Provider secrets must be
  // explicitly connected to this workspace; never silently fall back to a shared key.
  if (!credentials.http && process.env.AIVANTA_HTTP_ALLOWED_HOSTS) {
    credentials.http = { allowedHosts: process.env.AIVANTA_HTTP_ALLOWED_HOSTS, apiKeys: "{}" };
  }
  return credentials;
}
