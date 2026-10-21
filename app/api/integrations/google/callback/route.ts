import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
import { decryptGoogleCredentials, encryptGoogleCredentials, type GoogleCredentials } from "@/lib/integrations/google-credentials";
import { getGoogleOAuthConfig, isGoogleProduct } from "@/lib/integrations/google-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function connectionsUrl(request: NextRequest, status: string) {
  const response = NextResponse.redirect(new URL(`/dashboard/connections?google=${encodeURIComponent(status)}`, request.url));
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const clearCookies = (response: NextResponse) => {
    for (const name of ["aivanta_google_oauth_state", "aivanta_google_oauth_verifier", "aivanta_google_oauth_product", "aivanta_google_oauth_user"]) {
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

  if (!state || !expectedState || state !== expectedState || !code || !verifier || !initiatingUserId || !isGoogleProduct(product)) {
    return clearCookies(connectionsUrl(request, "invalid_state"));
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
    // Google may omit "scope" when it is identical to the requested scope. If it
    // does return a grant list, reject grants that don't include this product's
    // read-only scope or that include known write/send scopes.
    if (typeof raw.scope === "string") {
      const grantedScopes = raw.scope.split(" ").filter(Boolean);
      const requiredReadScope = product === "gmail"
        ? "https://www.googleapis.com/auth/gmail.readonly"
        : "https://www.googleapis.com/auth/spreadsheets.readonly";
      const hasUnexpectedWriteScope = grantedScopes.some((scope) =>
        /googleapis\.com\/auth\/(gmail\.(?!readonly$)[a-z.]+|spreadsheets(?!\.readonly$)(?:\.[a-z.]+)?|drive(?:\.[a-z.]+)?)/i.test(scope),
      );
      if (!grantedScopes.includes(requiredReadScope) || hasUnexpectedWriteScope) {
        return clearCookies(connectionsUrl(request, "scope_mismatch"));
      }
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
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      return clearCookies(connectionsUrl(request, "server_not_configured"));
    }

    // Service-role client is server-only. Every query is explicitly scoped to the
    // authenticated user's resolved workspace and actor; tokens are never selected back.
    const admin = createSupabaseClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Google may omit refresh_token on a subsequent consent. Preserve an existing
    // refresh token for this exact user/workspace/product/account rather than
    // accidentally replacing a durable connection with an access-token-only one.
    const { data: existing, error: existingError } = await admin.from("google_connections")
      .select("encrypted_credentials")
      .eq("workspace_id", workspace.id)
      .eq("connected_by", user.id)
      .eq("provider", "google")
      .eq("product", product)
      .eq("account_email", profile.email)
      .maybeSingle();
    if (existingError) return clearCookies(connectionsUrl(request, "save_failed"));
    if (!credentials.refresh_token && existing?.encrypted_credentials) {
      const previousCredentials = decryptGoogleCredentials(existing.encrypted_credentials);
      if (previousCredentials.refresh_token) credentials.refresh_token = previousCredentials.refresh_token;
    }

    const { error: saveError } = await admin.from("google_connections").upsert({
      workspace_id: workspace.id,
      connected_by: user.id,
      provider: "google",
      product,
      account_email: profile.email,
      scopes: (typeof raw.scope === "string" ? raw.scope : "").split(" ").filter(Boolean),
      encrypted_credentials: encryptGoogleCredentials(credentials),
      expires_at: credentials.expiry_date ? new Date(credentials.expiry_date).toISOString() : null,
      status: "connected",
      updated_at: new Date().toISOString(),
    }, { onConflict: "workspace_id,provider,product,account_email,connected_by" });

    if (saveError) return clearCookies(connectionsUrl(request, "save_failed"));
    return clearCookies(connectionsUrl(request, "connected"));
  } catch {
    // Deliberately do not log OAuth response bodies, codes, or credentials.
    return clearCookies(connectionsUrl(request, "connection_failed"));
  }
}
