import { NextResponse } from "next/server";
import { getAdminSupabaseConfig } from "@/lib/supabase/admin";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
import { decryptGoogleCredentials, encryptGoogleCredentials, type GoogleCredentials } from "@/lib/integrations/google-credentials";
import { getGoogleOAuthConfig, GOOGLE_PRODUCTS, hasOnlyApprovedGoogleScopes } from "@/lib/integrations/google-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Authentication required.", code: "CONNECTION_AUTH_REQUIRED" }, { status: 401, headers });

    const workspace = await getOrCreateDefaultWorkspace(supabase);
    let admin;
    try {
      const { url, serviceRoleKey } = getAdminSupabaseConfig();
      admin = createSupabaseClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
    } catch {
      return NextResponse.json({ error: "Connection storage is not configured for this deployment.", code: "CONNECTION_STORAGE_NOT_CONFIGURED" }, { status: 503, headers });
    }
    const { data, error } = await admin.from("google_connections")
      .select("id, product, account_email, scopes, status, expires_at, last_tested_at, last_test_status, created_at, updated_at")
      .eq("workspace_id", workspace.id)
      
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[connections] query failed", { code: error.code, message: error.message });
      return NextResponse.json({ error: "Rexnora could not read the Google connections table.", code: error.code === "PGRST205" || error.code === "42P01" ? "CONNECTION_TABLE_MISSING" : "CONNECTION_QUERY_FAILED" }, { status: 503, headers });
    }
    return NextResponse.json({ connections: data ?? [] }, { headers });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown_error";
    console.error("[connections] request failed", { detail });
    return NextResponse.json({ error: "Rexnora could not resolve your workspace connections.", code: "CONNECTIONS_UNAVAILABLE" }, { status: 500, headers });
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.CODED_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.CODED_SUPABASE_SERVICE_ROLE_KEY || process.env.CODED_SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("CONNECTION_STORAGE_NOT_CONFIGURED");
  return createSupabaseClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function requireWorkspaceAdmin(supabase: Awaited<ReturnType<typeof createClient>>, workspaceId: string, userId: string) {
  const { data, error } = await supabase.from("workspace_members").select("role")
    .eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return Boolean(data && ["owner", "admin"].includes(data.role));
}

export async function POST(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers });
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > 2048) return NextResponse.json({ error: "Request is too large." }, { status: 413, headers });
    let body: unknown;
    try { body = JSON.parse(rawBody); } catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400, headers }); }
    const connectionId = body && typeof body === "object" ? (body as { connectionId?: unknown }).connectionId : undefined;
    if (typeof connectionId !== "string" || !uuidPattern.test(connectionId)) return NextResponse.json({ error: "Choose a Google connection to test." }, { status: 400, headers });
    const workspace = await getOrCreateDefaultWorkspace(supabase);
    if (!await requireWorkspaceAdmin(supabase, workspace.id, user.id)) return NextResponse.json({ error: "Only workspace owners and admins can test connections." }, { status: 403, headers });
    const admin = serviceClient();
    const { data: connection, error: lookupError } = await admin.from("google_connections")
      .select("id,product,account_email,scopes,status,encrypted_credentials")
      .eq("id", connectionId).eq("workspace_id", workspace.id).eq("provider", "google").maybeSingle();
    if (lookupError) throw lookupError;
    if (!connection) return NextResponse.json({ error: "Google connection not found in this workspace." }, { status: 404, headers });
    // Fail closed while this account is being re-verified.
    const { error: invalidateError } = await admin.from("google_connections").update({
      status: "needs_reauth", last_tested_at: null, last_test_status: null,
    }).eq("id", connection.id).eq("workspace_id", workspace.id);
    if (invalidateError) throw invalidateError;
    const product = connection.product as keyof typeof GOOGLE_PRODUCTS;
    const requiredScope = GOOGLE_PRODUCTS[product]?.scopes?.[0];
    if (!requiredScope || !Array.isArray(connection.scopes) || !connection.scopes.includes(requiredScope) ||
        !hasOnlyApprovedGoogleScopes(product, connection.scopes.join(" "))) {
      await admin.from("google_connections").update({ last_tested_at: new Date().toISOString(), last_test_status: "failed", status: "needs_reauth" })
        .eq("id", connection.id).eq("workspace_id", workspace.id);
      return NextResponse.json({ ok: false, message: "The saved Google consent does not contain the required product scope. Reconnect this account." }, { status: 409, headers });
    }
    let credentials: GoogleCredentials;
    try { credentials = decryptGoogleCredentials(connection.encrypted_credentials); }
    catch {
      return NextResponse.json({ ok: false, message: "The encrypted Google credential could not be opened. Reconnect this account." }, { status: 503, headers });
    }
    if (!credentials.access_token) return NextResponse.json({ ok: false, message: "Google access token is missing. Reconnect this account." }, { status: 409, headers });
    if ((credentials.expiry_date ?? 0) <= Date.now() + 60_000) {
      if (!credentials.refresh_token) return NextResponse.json({ ok: false, message: "This Google account has no refresh token. Reconnect it with offline access." }, { status: 409, headers });
      let oauthConfig;
      try { oauthConfig = getGoogleOAuthConfig(); }
      catch { return NextResponse.json({ ok: false, message: "Google OAuth is not configured on this deployment." }, { status: 503, headers }); }
      const refreshResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: oauthConfig.clientId, client_secret: oauthConfig.clientSecret,
          refresh_token: credentials.refresh_token, grant_type: "refresh_token",
        }),
        cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000),
      });
      const refreshed = await refreshResponse.json().catch(() => null) as {
        access_token?: unknown; expires_in?: unknown; scope?: unknown; token_type?: unknown;
      } | null;
      if (!refreshResponse.ok || typeof refreshed?.access_token !== "string" ||
          typeof refreshed.expires_in !== "number" || !Number.isFinite(refreshed.expires_in)) {
        return NextResponse.json({ ok: false, message: "Google could not refresh this account. Reconnect it and test again." }, { status: 409, headers });
      }
      const refreshedExpiry = Date.now() + refreshed.expires_in * 1000;
      credentials = {
        ...credentials,
        access_token: refreshed.access_token,
        expiry_date: refreshedExpiry,
        ...(typeof refreshed.scope === "string" ? { scope: refreshed.scope } : {}),
        ...(typeof refreshed.token_type === "string" ? { token_type: refreshed.token_type } : {}),
      };
      const { error: refreshSaveError } = await admin.from("google_connections").update({
        encrypted_credentials: encryptGoogleCredentials(credentials),
        expires_at: new Date(refreshedExpiry).toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", connection.id).eq("workspace_id", workspace.id);
      if (refreshSaveError) throw refreshSaveError;
    }
    const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: "Bearer " + credentials.access_token },
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000),
    });
    let profile: unknown = null;
    if (profileResponse.ok) profile = await profileResponse.json().catch(() => null);
    const validIdentity = Boolean(profile && typeof profile === "object" &&
      (profile as { email?: unknown }).email === connection.account_email &&
      (profile as { email_verified?: unknown }).email_verified === true);
    let validProductAccess = true;
    if (validIdentity && product === "calendar") {
      // A connection test may read one event to verify access; it must never create or change events.
      try {
        const probe = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=1", {
          headers: { Authorization: "Bearer " + credentials.access_token },
          cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000),
        });
        validProductAccess = probe.ok;
      } catch { validProductAccess = false; }
    }
    const validConnection = validIdentity && validProductAccess;
    const testedAt = new Date().toISOString();
    const { error: updateError } = await admin.from("google_connections").update({
      last_tested_at: testedAt,
      last_test_status: validConnection ? "passed" : "failed",
      status: validConnection ? "connected" : "needs_reauth",
    }).eq("id", connection.id).eq("workspace_id", workspace.id);
    if (updateError) throw updateError;
    if (!validIdentity) return NextResponse.json({ ok: false, message: profileResponse.status === 401
      ? "Google rejected the saved access token. Reconnect this account."
      : "Google identity could not be verified for this saved account. Reconnect it and test again." }, { status: 409, headers });
    if (!validProductAccess) return NextResponse.json({ ok: false, message: "Google verified the account identity, but the primary Calendar could not be read with the saved permission. Reconnect and test again." }, { status: 409, headers });
    return NextResponse.json({
      ok: true, last_tested_at: testedAt,
      verification: product === "calendar" ? "google_identity_and_calendar_read_probe" : "google_identity_and_product_scope",
      message: product === "calendar"
        ? "Google verified the account identity and primary Calendar access. This connection test did not create or change any events."
        : "Google verified this account identity and the exact product scope requested by this node. No provider data was changed.",
    }, { headers });
  } catch {
    return NextResponse.json({ error: "Could not verify this Google connection." }, { status: 500, headers });
  }
}

export async function DELETE(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers });
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > 2048) return NextResponse.json({ error: "Request is too large." }, { status: 413, headers });
    let body: unknown;
    try { body = JSON.parse(rawBody); } catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400, headers }); }
    const connectionId = body && typeof body === "object" ? (body as { connectionId?: unknown }).connectionId : undefined;
    if (typeof connectionId !== "string" || !uuidPattern.test(connectionId)) return NextResponse.json({ error: "Choose a Google connection to disconnect." }, { status: 400, headers });
    const workspace = await getOrCreateDefaultWorkspace(supabase);
    if (!await requireWorkspaceAdmin(supabase, workspace.id, user.id)) return NextResponse.json({ error: "Only workspace owners and admins can disconnect connections." }, { status: 403, headers });
    const admin = serviceClient();
    const { data: connection, error: lookupError } = await admin.from("google_connections")
      .select("id,encrypted_credentials").eq("id", connectionId).eq("workspace_id", workspace.id)
      .eq("provider", "google").maybeSingle();
    if (lookupError) throw lookupError;
    if (!connection) return NextResponse.json({ error: "Google connection not found in this workspace." }, { status: 404, headers });
    let remoteRevoked = false;
    try {
      const credentials = decryptGoogleCredentials(connection.encrypted_credentials);
      const token = credentials.refresh_token || credentials.access_token;
      if (token) {
        const revokeResponse = await fetch("https://oauth2.googleapis.com/revoke", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token }),
          cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5000),
        });
        remoteRevoked = revokeResponse.ok;
      }
    } catch {
      // Local disconnect is still mandatory. The response reports remote revoke separately.
    }
    const { error: deleteError } = await admin.from("google_connections")
      .delete().eq("id", connectionId).eq("workspace_id", workspace.id);
    if (deleteError) throw deleteError;
    return NextResponse.json({
      success: true, disconnected: true, remoteRevoked,
      message: remoteRevoked ? "Disconnected and Google accepted the token revocation." : "Disconnected from this workspace. Google could not confirm remote token revocation; review active grants in your Google Account.",
    }, { headers });
  } catch {
    return NextResponse.json({ error: "Could not disconnect this Google account." }, { status: 500, headers });
  }
}
