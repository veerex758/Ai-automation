import { NextRequest, NextResponse } from "next/server";
import { getAdminSupabaseConfig } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
import { decryptGoogleCredentials, encryptGoogleCredentials, type GoogleCredentials } from "@/lib/integrations/google-credentials";
import { GOOGLE_PRODUCTS, getGoogleOAuthConfig, hasOnlyApprovedGoogleScopes, isGoogleProduct } from "@/lib/integrations/google-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function connectionsUrl(request: NextRequest, status: string) {
  const query = new URLSearchParams({ google: status });
  const product = request.cookies.get("aivanta_google_oauth_product")?.value;
  const node = request.cookies.get("aivanta_google_oauth_node")?.value;
  if (product && ["gmail", "sheets", "drive", "calendar", "docs", "forms", "youtube", "contacts"].includes(product)) query.set("googleProduct", product);
  if (node && /^[a-z_]{2,40}$/.test(node)) query.set("node", node);
  const response = NextResponse.redirect(new URL(`/dashboard/connections?${query.toString()}`, request.url));
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const clearCookies = (response: NextResponse) => {
    for (const name of ["aivanta_google_oauth_state", "aivanta_google_oauth_verifier", "aivanta_google_oauth_product", "aivanta_google_oauth_user", "aivanta_google_oauth_node", "aivanta_google_oauth_connection"]) {
      response.cookies.set(name, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/integrations/google", maxAge: 0 });
    }
    return response;
  };

  const providerError = url.searchParams.get("error");
  if (providerError) return clearCookies(connectionsUrl(request, "cancelled"));

  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const expectedState = request.cookies.get("aivanta_google_oauth_state")?.value;
  const verifier = request.cookies.get("aivanta_google_oauth_verifier")?.value;
  const product = request.cookies.get("aivanta_google_oauth_product")?.value;
  const initiatingUserId = request.cookies.get("aivanta_google_oauth_user")?.value;
  const targetConnectionId = request.cookies.get("aivanta_google_oauth_connection")?.value || undefined;

  if (!state || !expectedState) {
    console.warn("[google-oauth] state cookie or response state missing", { responseStatePresent: Boolean(state), stateCookiePresent: Boolean(expectedState) });
    return clearCookies(connectionsUrl(request, "state_cookie_missing"));
  }
  if (state !== expectedState) {
    console.warn("[google-oauth] OAuth state mismatch");
    return clearCookies(connectionsUrl(request, "state_mismatch"));
  }
  if (!code || !verifier || !initiatingUserId || !isGoogleProduct(product)) {
    console.warn("[google-oauth] callback context incomplete", { codePresent: Boolean(code), verifierPresent: Boolean(verifier), userCookiePresent: Boolean(initiatingUserId), productValid: isGoogleProduct(product) });
    return clearCookies(connectionsUrl(request, "callback_context_missing"));
  }

  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return clearCookies(connectionsUrl(request, "sign_in_required"));
    if (user.id !== initiatingUserId) return clearCookies(connectionsUrl(request, "user_changed"));

    const config = getGoogleOAuthConfig();
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: "authorization_code",
        code_verifier: verifier,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });

    if (!tokenResponse.ok) return clearCookies(connectionsUrl(request, "token_exchange_failed"));
    const tokenPayload: unknown = await tokenResponse.json();
    if (!tokenPayload || typeof tokenPayload !== "object" || !("access_token" in tokenPayload)
        || typeof tokenPayload.access_token !== "string") {
      return clearCookies(connectionsUrl(request, "token_exchange_failed"));
    }

    const raw = tokenPayload as Record<string, unknown>;
    // Accept only basic identity scopes and the requested product's read-only scope.
    if (!hasOnlyApprovedGoogleScopes(product, raw.scope)) {
      return clearCookies(connectionsUrl(request, "scope_mismatch"));
    }
    const credentials: GoogleCredentials = {
      access_token: raw.access_token as string,
      ...(typeof raw.refresh_token === "string" ? { refresh_token: raw.refresh_token } : {}),
      ...(typeof raw.token_type === "string" ? { token_type: raw.token_type } : {}),
      ...(typeof raw.scope === "string" ? { scope: raw.scope } : {}),
      ...(typeof raw.expires_in === "number" ? { expiry_date: Date.now() + raw.expires_in * 1000 } : {}),
    };

    const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${credentials.access_token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!profileResponse.ok) return clearCookies(connectionsUrl(request, "profile_failed"));
    const profile: unknown = await profileResponse.json();
    if (!profile || typeof profile !== "object" || !("email" in profile)
        || typeof profile.email !== "string" || !("email_verified" in profile)
        || profile.email_verified !== true) {
      return clearCookies(connectionsUrl(request, "profile_failed"));
    }

    const workspace = await getOrCreateDefaultWorkspace(supabase);
    const { data: membership, error: membershipError } = await supabase.from("workspace_members")
      .select("role").eq("workspace_id", workspace.id).eq("user_id", user.id).maybeSingle();
    if (membershipError || !membership || !["owner", "admin"].includes(membership.role)) {
      return clearCookies(connectionsUrl(request, "permission_denied"));
    }
    let adminConfig: ReturnType<typeof getAdminSupabaseConfig>;
    try { adminConfig = getAdminSupabaseConfig(); }
    catch { return clearCookies(connectionsUrl(request, "server_not_configured")); }
    const { url: supabaseUrl, serviceRoleKey } = adminConfig;

    // Service-role client is server-only. Every query is explicitly scoped to the
    // authenticated user's resolved workspace and actor; tokens are never selected back.
    const admin = createSupabaseClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Google may omit refresh_token on a subsequent consent. Preserve an existing
    // refresh token for this exact user/workspace/product/account rather than
    // accidentally replacing a durable connection with an access-token-only one.
    if (targetConnectionId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetConnectionId)) {
      return clearCookies(connectionsUrl(request, "connection_target_invalid"));
    }
    let existingQuery = admin.from("google_connections")
      .select("id,account_email,encrypted_credentials")
      .eq("workspace_id", workspace.id)
      .eq("provider", "google")
      .eq("product", product);
    existingQuery = targetConnectionId
      ? existingQuery.eq("id", targetConnectionId)
      : existingQuery.eq("connected_by", user.id).eq("account_email", profile.email);
    const { data: existing, error: existingError } = await existingQuery.maybeSingle();
    if (existingError || (targetConnectionId && !existing)) return clearCookies(connectionsUrl(request, "save_failed"));
    if (!credentials.refresh_token && existing?.encrypted_credentials && existing.account_email === profile.email) {
      const previousCredentials = decryptGoogleCredentials(existing.encrypted_credentials);
      if (previousCredentials.refresh_token) credentials.refresh_token = previousCredentials.refresh_token;
    }

    const connectionValues = {
      ...(targetConnectionId ? {} : { workspace_id: workspace.id, connected_by: user.id }),
      provider: "google",
      product,
      account_email: profile.email,
      scopes: typeof raw.scope === "string" ? raw.scope.split(/\s+/).filter(Boolean) : [...GOOGLE_PRODUCTS[product].scopes],
      encrypted_credentials: encryptGoogleCredentials(credentials),
      expires_at: credentials.expiry_date ? new Date(credentials.expiry_date).toISOString() : null,
      status: "connected",
      last_tested_at: null,
      last_test_status: null,
      updated_at: new Date().toISOString(),
    };
    if (targetConnectionId) {
      const { data: updated, error: updateError } = await admin.from("google_connections")
        .update(connectionValues)
        .eq("id", targetConnectionId).eq("workspace_id", workspace.id)
        .eq("provider", "google").eq("product", product).select("id").maybeSingle();
      if (updateError || !updated) return clearCookies(connectionsUrl(request, "save_failed"));
    } else {
      const { error: saveError } = await admin.from("google_connections").upsert({
        ...connectionValues,
        workspace_id: workspace.id,
        connected_by: user.id,
      }, { onConflict: "workspace_id,provider,product,account_email,connected_by" });
      if (saveError) return clearCookies(connectionsUrl(request, "save_failed"));
    }
    return clearCookies(connectionsUrl(request, "connected"));
  } catch {
    // Deliberately do not log OAuth response bodies, codes, or credentials.
    return clearCookies(connectionsUrl(request, "connection_failed"));
  }
}
