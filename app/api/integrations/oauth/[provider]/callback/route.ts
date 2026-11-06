import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
import { encryptWorkspaceCredentials, type WorkspaceCredentialProvider } from "@/lib/integrations/workspace-credentials";
import {
  exchangeProviderOAuthCode,
  exchangeMetaLongLivedToken,
  PROVIDER_OAUTH_CONFIG,
  verifyOAuthState,
} from "@/lib/integrations/provider-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("INTEGRATION_DATABASE_NOT_CONFIGURED");
  return createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

function finish(request: NextRequest, provider: string, success: boolean) {
  const destination = new URL("/dashboard/integrations", request.url);
  destination.searchParams.set("oauth", success ? "connected" : "failed");
  destination.searchParams.set("provider", provider);
  const response = NextResponse.redirect(destination);
  response.cookies.set("aivanta_oauth_" + provider, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/integrations/oauth/" + provider + "/callback",
    maxAge: 0,
  });
  return response;
}

function sameSecret(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  const { provider } = await context.params;
  if (!PROVIDER_OAUTH_CONFIG[provider]) return finish(request, provider, false);
  const params = new URL(request.url).searchParams;
  const state = params.get("state");
  const code = params.get("code");
  const cookieState = request.cookies.get("aivanta_oauth_" + provider)?.value;
  if (params.has("error") || !state || !code || !cookieState || !sameSecret(state, cookieState)) {
    return finish(request, provider, false);
  }

  try {
    const stateData = verifyOAuthState(state, provider);
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user || user.id !== stateData.userId) return finish(request, provider, false);
    const workspace = await getOrCreateDefaultWorkspace(supabase);
    if (workspace.id !== stateData.workspaceId) return finish(request, provider, false);

    const config = PROVIDER_OAUTH_CONFIG[provider];
    let token = await exchangeProviderOAuthCode({
      provider, config, code,
      redirectUri: new URL("/api/integrations/oauth/" + encodeURIComponent(provider) + "/callback", request.url).toString(),
      codeVerifier: stateData.codeVerifier,
    });
    if (config.tokenExchangeMode === "meta-long-lived") {
      token = await exchangeMetaLongLivedToken({ provider, accessToken: token.access_token, config });
    }

    const credentials: Record<string, string> = { accessToken: token.access_token };
    if (typeof token.refresh_token === "string") credentials.refreshToken = token.refresh_token;
    if (typeof token.expires_in === "number" && Number.isFinite(token.expires_in)) credentials.expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();
    if (typeof token.token_type === "string") credentials.tokenType = token.token_type;
    if (typeof token.scope === "string") credentials.scope = token.scope;
    if (typeof token.instance_url === "string") credentials.instanceUrl = token.instance_url;

    const key = process.env.AIVANTA_CREDENTIALS_ENCRYPTION_KEY;
    if (!key) throw new Error("WORKSPACE_CREDENTIAL_ENCRYPTION_NOT_CONFIGURED");
    const encrypted = encryptWorkspaceCredentials({ [provider]: credentials } as Record<WorkspaceCredentialProvider, Record<string, string>>, key, workspace.id + ":" + provider);
    const admin = serviceClient();
    const { data: integration, error: integrationError } = await admin.from("workspace_integrations")
      .upsert({
        workspace_id: workspace.id,
        provider,
        status: "connected",
        display_name: provider.replace(/_/g, " "),
        metadata: { connected_at: new Date().toISOString(), expires_at: credentials.expiresAt ?? null, scope: credentials.scope ?? null },
        created_by: user.id,
      }, { onConflict: "workspace_id,provider" })
      .select("id")
      .single();
    if (integrationError || !integration?.id) throw new Error("OAUTH_INTEGRATION_SAVE_FAILED");
    const { error: secretError } = await admin.from("workspace_integration_secrets").upsert({
      integration_id: integration.id,
      encrypted_credentials: encrypted,
      encryption_version: "v1",
      updated_at: new Date().toISOString(),
    }, { onConflict: "integration_id" });
    if (secretError) throw new Error("OAUTH_CREDENTIAL_SAVE_FAILED");
    return finish(request, provider, true);
  } catch (error) {
    console.error("Provider OAuth callback failed", { provider, code: error instanceof Error ? error.message : "OAUTH_CALLBACK_FAILED" });
    return finish(request, provider, false);
  }
}
