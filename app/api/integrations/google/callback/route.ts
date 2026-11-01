import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
import { encryptGoogleCredentials } from "@/lib/integrations/google-credentials";

export const dynamic = "force-dynamic";
const COOKIE = "aivanta_google_oauth_state";
const requiredScopes = {
  gmail: "https://www.googleapis.com/auth/gmail.readonly",
  sheets: "https://www.googleapis.com/auth/spreadsheets.readonly",
} as const;

function validState(state: string, cookie: string) {
  if (state !== cookie) return false;
  const parts = state.split(".");
  if (parts.length !== 5) return false;
  const [workspaceId, product, issuedAt, nonce, supplied] = parts;
  if (!workspaceId || !/^[0-9a-f-]{36}$/i.test(workspaceId) ||
      (product !== "gmail" && product !== "sheets") ||
      !/^\d{13}$/.test(issuedAt) || Date.now() - Number(issuedAt) > 600_000 ||
      Date.now() < Number(issuedAt) || !nonce || !supplied) return false;
  const secret = process.env.AIVANTA_CREDENTIALS_ENCRYPTION_KEY;
  if (!secret) return false;
  const payload = parts.slice(0, 4).join(".");
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

function finish(request: NextRequest, result: string) {
  const response = NextResponse.redirect(new URL("/dashboard/integrations?google=" + encodeURIComponent(result), request.url));
  response.cookies.delete(COOKIE);
  return response;
}

export async function GET(request: NextRequest) {
  const state = request.nextUrl.searchParams.get("state") ?? "";
  const cookie = request.cookies.get(COOKIE)?.value ?? "";
  if (!validState(state, cookie)) return finish(request, "invalid_state");
  const [, product] = state.split(".");
  const code = request.nextUrl.searchParams.get("code");
  if (request.nextUrl.searchParams.has("error") || !code) return finish(request, "cancelled");
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return finish(request, "session_expired");
    const workspace = await getOrCreateDefaultWorkspace(supabase);
    if (workspace.id !== state.split(".")[0]) return finish(request, "workspace_changed");
    const { data: membership } = await supabase.from("workspace_members").select("role")
      .eq("workspace_id", workspace.id).eq("user_id", user.id).maybeSingle();
    if (!membership || !["owner", "admin"].includes(membership.role)) return finish(request, "forbidden");

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;
    if (!clientId || !clientSecret || !redirectUri) return finish(request, "not_configured");
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
      cache: "no-store", signal: AbortSignal.timeout(12_000),
    });
    const token: unknown = await tokenResponse.json().catch(() => null);
    if (!tokenResponse.ok || !token || typeof token !== "object" ||
        !("access_token" in token) || typeof token.access_token !== "string" ||
        !("scope" in token) || typeof token.scope !== "string") return finish(request, "token_exchange_failed");
    const grantedScopes = token.scope.split(/\s+/);
    const requiredScope = requiredScopes[product as keyof typeof requiredScopes];
    if (!grantedScopes.includes(requiredScope)) return finish(request, "missing_scope");
    const profileResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: "Bearer " + token.access_token }, cache: "no-store", signal: AbortSignal.timeout(8_000),
    });
    const profile: unknown = await profileResponse.json().catch(() => null);
    if (!profileResponse.ok || !profile || typeof profile !== "object" ||
        !("email" in profile) || typeof profile.email !== "string") return finish(request, "profile_lookup_failed");
    const raw = token as { access_token: string; refresh_token?: unknown; token_type?: unknown; expires_in?: unknown };
    const credentials = {
      access_token: raw.access_token,
      ...(typeof raw.refresh_token === "string" ? { refresh_token: raw.refresh_token } : {}),
      ...(typeof raw.token_type === "string" ? { token_type: raw.token_type } : {}),
      scope: token.scope,
      ...(typeof raw.expires_in === "number" ? { expiry_date: Date.now() + raw.expires_in * 1000 } : {}),
    };
    if (!credentials.refresh_token) {
      const admin = createAdminClient();
      const { data: previous } = await admin.from("google_connections").select("encrypted_credentials")
        .eq("workspace_id", workspace.id).eq("product", product).maybeSingle();
      if (previous?.encrypted_credentials) {
        const { decryptGoogleCredentials } = await import("@/lib/integrations/google-credentials");
        const prior = decryptGoogleCredentials(previous.encrypted_credentials);
        if (prior.refresh_token) credentials.refresh_token = prior.refresh_token;
      }
    }
    const admin = createAdminClient();
    const { error: saveError } = await admin.from("google_connections").upsert({
      workspace_id: workspace.id, product, account_email: profile.email,
      encrypted_credentials: encryptGoogleCredentials(credentials), scopes: grantedScopes,
      status: "connected", expires_at: credentials.expiry_date ? new Date(credentials.expiry_date).toISOString() : null,
      connected_by: user.id, updated_at: new Date().toISOString(),
    }, { onConflict: "workspace_id,product" });
    if (saveError) return finish(request, "save_failed");
    return finish(request, "connected_" + product);
  } catch {
    return finish(request, "connection_failed");
  }
}
