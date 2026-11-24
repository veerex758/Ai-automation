import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { getAdminSupabaseConfig } from "@/lib/supabase/admin";
import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
import { encryptWorkspaceCredentialsV2 } from "@/lib/integrations/workspace-credentials";
import { enforceDistributedRateLimit } from "@/lib/security/distributed-rate-limit";
import {
  exchangeProviderOAuthCode,
  exchangeMetaLongLivedToken,
  PROVIDER_OAUTH_CONFIG,
  verifyOAuthState,
  selectInstagramBusinessAccount,
} from "@/lib/integrations/provider-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function serviceClient() {
  const { url, serviceRoleKey: key } = getAdminSupabaseConfig();
  if (!url || !key) throw new Error("INTEGRATION_DATABASE_NOT_CONFIGURED");
  return createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

function finish(request: NextRequest, provider: string, success: boolean) {
  const destination = new URL("/dashboard/connections", request.url);
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
  response.cookies.set("aivanta_oauth_verifier_" + provider, "", {
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
  const codeVerifier = request.cookies.get("aivanta_oauth_verifier_" + provider)?.value;
  if (params.has("error") || !state || !code || !cookieState || !codeVerifier || !sameSecret(state, cookieState)) {
    return finish(request, provider, false);
  }

  try {
    const stateData = verifyOAuthState(state, provider);
    const actualChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
    if (!sameSecret(actualChallenge, stateData.codeChallenge)) return finish(request, provider, false);
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user || user.id !== stateData.userId) return finish(request, provider, false);
    const workspace = await getOrCreateDefaultWorkspace(supabase);
    if (workspace.id !== stateData.workspaceId) return finish(request, provider, false);
    const { data: membership, error: membershipError } = await supabase.from("workspace_members")
      .select("role").eq("workspace_id", workspace.id).eq("user_id", user.id).maybeSingle();
    if (membershipError || !membership || !["owner", "admin"].includes(membership.role)) {
      return finish(request, provider, false);
    }
    const limited = await enforceDistributedRateLimit(request, {
      scope: "provider-oauth-callback", windowMs: 15 * 60_000,
      ipLimit: 10, userId: user.id, userLimit: 10,
      workspaceId: workspace.id, workspaceLimit: 20,
      resourceId: provider, resourceLimit: 10,
    });
    if (limited) return finish(request, provider, false);

    const config = PROVIDER_OAUTH_CONFIG[provider];
    let token = await exchangeProviderOAuthCode({
      provider, config, code,
      redirectUri: new URL("/api/integrations/oauth/" + encodeURIComponent(provider) + "/callback", request.url).toString(),
      codeVerifier,
    });
    if (config.tokenExchangeMode === "meta-long-lived") {
      token = await exchangeMetaLongLivedToken({ provider, accessToken: token.access_token, config });
    }

    const credentials: Record<string, string> = { accessToken: token.access_token };
    if (provider === "facebook_pages" || provider === "instagram") {
      const pagesUrl = new URL("https://graph.facebook.com/v21.0/me/accounts");
      pagesUrl.searchParams.set("fields", "id,name,access_token,instagram_business_account{id,username}");
      const pagesResponse = await fetch(pagesUrl, {
        headers: { Authorization: "Bearer " + token.access_token },
        cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000),
      });
      const pagePayload = await pagesResponse.json().catch(() => null) as { data?: unknown };
      if (!pagesResponse.ok || !Array.isArray(pagePayload?.data)) throw new Error("META_PAGE_LOOKUP_FAILED");
      if (provider === "facebook_pages") {
        const page = pagePayload.data.find((item) => item && typeof item === "object" &&
          typeof (item as Record<string, unknown>).access_token === "string") as Record<string, unknown> | undefined;
        if (!page) throw new Error("FACEBOOK_PAGE_NOT_FOUND");
        credentials.pageAccessToken = page.access_token as string;
      } else {
        const accounts = pagePayload.data.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const account = (item as Record<string, unknown>).instagram_business_account;
          return account && typeof account === "object" ? [account] : [];
        });
        const account = selectInstagramBusinessAccount(accounts);
        const page = pagePayload.data.find((item) => item && typeof item === "object" &&
          (item as Record<string, unknown>).instagram_business_account &&
          ((item as Record<string, unknown>).instagram_business_account as Record<string, unknown>).id === account.id) as Record<string, unknown> | undefined;
        if (!page || typeof page.access_token !== "string") throw new Error("INSTAGRAM_PAGE_TOKEN_NOT_FOUND");
        credentials.accessToken = page.access_token;
        credentials.igUserId = account.id;
      }
    }
    if (typeof token.refresh_token === "string") credentials.refreshToken = token.refresh_token;
    if (typeof token.expires_in === "number" && Number.isFinite(token.expires_in)) credentials.expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();
    if (typeof token.token_type === "string") credentials.tokenType = token.token_type;
    if (typeof token.scope === "string") credentials.scope = token.scope;
    if (typeof token.instance_url === "string") credentials.instanceUrl = token.instance_url;

    const key = process.env.AIVANTA_CREDENTIALS_ENCRYPTION_KEY;
    if (!key) throw new Error("WORKSPACE_CREDENTIAL_ENCRYPTION_NOT_CONFIGURED");
    const connectionId = stateData.connectionId ?? randomUUID();
    const encrypted = encryptWorkspaceCredentialsV2({ [provider]: credentials }, workspace.id + ":" + provider + ":" + connectionId, key);
    const admin = serviceClient();
    const connectedAt = new Date().toISOString();
    const displayName = provider.replace(/_/g, " ") + " · " + new Date(connectedAt).toLocaleString("en-US", {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC",
    }) + " UTC";
    const { data: saved, error: saveError } = await admin.rpc("save_workspace_integration_connection", {
      p_workspace_id: workspace.id,
      p_provider: provider,
      p_display_name: displayName,
      p_encrypted_credentials: encrypted,
      p_created_by: user.id,
      p_connection_id: connectionId,
      p_create_new: stateData.connectionId === undefined,
    });
    const integrationId = saved && typeof saved === "object" && "id" in saved &&
      typeof (saved as { id?: unknown }).id === "string" ? (saved as { id: string }).id : null;
    if (saveError || !integrationId) throw new Error("OAUTH_INTEGRATION_SAVE_FAILED");
    const { error: metadataError } = await admin.from("workspace_integrations").update({
      metadata: { connected_at: connectedAt, expires_at: credentials.expiresAt ?? null, scope: credentials.scope ?? null },
    }).eq("id", integrationId).eq("workspace_id", workspace.id).eq("provider", provider);
    if (metadataError) throw new Error("OAUTH_CREDENTIAL_METADATA_SAVE_FAILED");
    return finish(request, provider, true);
  } catch (error) {
    console.error("Provider OAuth callback failed", { provider, code: error instanceof Error ? error.message : "OAUTH_CALLBACK_FAILED" });
    return finish(request, provider, false);
  }
}
