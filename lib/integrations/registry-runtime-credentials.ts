import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { decryptWorkspaceCredentials } from "@/lib/integrations/workspace-credentials";
import { decryptGoogleCredentials, encryptGoogleCredentials, type GoogleCredentials } from "@/lib/integrations/google-credentials";
import type { RegisteredWorkflowStep } from "@/nodes/workflow-runner";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("WORKSPACE_CREDENTIAL_STORAGE_NOT_CONFIGURED");
  return createSupabaseClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function getGoogleAccessToken(admin: ReturnType<typeof adminClient>, workspaceId: string, product: "gmail" | "sheets") {
  const { data: connection, error } = await admin.from("google_connections")
    .select("id,encrypted_credentials,expires_at,status")
    .eq("workspace_id", workspaceId).eq("provider", "google").eq("product", product)
    .eq("status", "connected").order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error("GOOGLE_CONNECTION_LOOKUP_FAILED");
  if (!connection) throw new Error("GOOGLE_CONNECTION_MISSING:" + product);

  let credentials: GoogleCredentials;
  try { credentials = decryptGoogleCredentials(connection.encrypted_credentials); }
  catch { throw new Error("GOOGLE_CREDENTIAL_DECRYPTION_FAILED:" + product); }

  const expiry = credentials.expiry_date ?? (connection.expires_at ? Date.parse(connection.expires_at) : 0);
  if (expiry && expiry <= Date.now() + 60000) {
    if (!credentials.refresh_token) throw new Error("GOOGLE_REAUTH_REQUIRED:" + product);
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error("GOOGLE_OAUTH_NOT_CONFIGURED");
    let response: Response;
    try {
      response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: credentials.refresh_token, grant_type: "refresh_token" }),
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
    } catch { throw new Error("GOOGLE_TOKEN_REFRESH_UNAVAILABLE"); }
    if (!response.ok) throw new Error(response.status === 400 || response.status === 401 ? "GOOGLE_REAUTH_REQUIRED:" + product : "GOOGLE_TOKEN_REFRESH_FAILED");
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object" || !("access_token" in payload) || typeof payload.access_token !== "string") {
      throw new Error("GOOGLE_TOKEN_REFRESH_INVALID_RESPONSE");
    }
    const raw = payload as Record<string, unknown>;
    const accessToken = (payload as { access_token: string }).access_token;
    const expiresIn = typeof raw.expires_in === "number" ? raw.expires_in : undefined;
    const tokenType = typeof raw.token_type === "string" ? raw.token_type : undefined;
    const scope = typeof raw.scope === "string" ? raw.scope : undefined;
    credentials = {
      ...credentials,
      access_token: accessToken,
      ...(expiresIn !== undefined ? { expiry_date: Date.now() + expiresIn * 1000 } : {}),
      ...(tokenType ? { token_type: tokenType } : {}),
      ...(scope ? { scope } : {}),
    };
    const { error: updateError } = await admin.from("google_connections").update({
      encrypted_credentials: encryptGoogleCredentials(credentials),
      expires_at: credentials.expiry_date ? new Date(credentials.expiry_date).toISOString() : null,
      updated_at: new Date().toISOString(),
    }).eq("id", connection.id).eq("workspace_id", workspaceId);
    if (updateError) throw new Error("GOOGLE_TOKEN_REFRESH_SAVE_FAILED");
  }
  if (!credentials.access_token) throw new Error("GOOGLE_REAUTH_REQUIRED:" + product);
  return credentials.access_token;
}

/**
 * Resolve only credentials required by this workflow from its workspace.
 * Secrets are decrypted in this server-only module and never copied to workflow inputs.
 */
export async function loadWorkspaceNodeCredentials(workspaceId: string, steps: RegisteredWorkflowStep[]): Promise<Record<string, Record<string, string>>> {
  const requested = new Set(steps.filter((step) => step.kind === "action").map((step) => step.nodeId));
  const credentials: Record<string, Record<string, string>> = {};
  const apiProviders = ["notion", "discord", "telegram", "airtable", "trello", "hubspot"].filter((provider) => requested.has(provider));
  let admin: ReturnType<typeof adminClient> | null = null;
  const getAdmin = () => admin ?? (admin = adminClient());

  if (apiProviders.length) {
    const { data: integrations, error } = await getAdmin().from("workspace_integrations")
      .select("id,provider,status").eq("workspace_id", workspaceId).in("provider", apiProviders);
    if (error) throw new Error("WORKSPACE_CREDENTIAL_LOOKUP_FAILED");
    const byProvider = new Map((integrations ?? []).map((item) => [item.provider, item]));
    for (const provider of apiProviders) {
      const integration = byProvider.get(provider);
      if (!integration || integration.status !== "connected") throw new Error("WORKSPACE_CREDENTIAL_MISSING:" + provider);
      const { data: secret, error: secretError } = await getAdmin().from("workspace_integration_secrets")
        .select("encrypted_credentials,encryption_version").eq("integration_id", integration.id).maybeSingle();
      if (secretError || !secret || secret.encryption_version !== "v1") throw new Error("WORKSPACE_CREDENTIAL_MISSING:" + provider);
      try { credentials[provider] = decryptWorkspaceCredentials(secret.encrypted_credentials); }
      catch { throw new Error("WORKSPACE_CREDENTIAL_DECRYPTION_FAILED:" + provider); }
    }
  }

  if (requested.has("google_sheets")) {
    credentials.google_sheets = { accessToken: await getGoogleAccessToken(getAdmin(), workspaceId, "sheets") };
  }
  if (requested.has("gmail")) {
    credentials.gmail = { accessToken: await getGoogleAccessToken(getAdmin(), workspaceId, "gmail") };
  }
  return credentials;
}
