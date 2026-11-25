import { randomBytes, createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getGoogleOAuthConfig, GOOGLE_PRODUCTS, isGoogleProduct } from "@/lib/integrations/google-oauth";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function base64url(value: Buffer) {
  return value.toString("base64url");
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return NextResponse.redirect(new URL("/login?next=%2Fdashboard%2Fconnections", request.url));
  }

  const productValue = request.nextUrl.searchParams.get("product");
  if (!isGoogleProduct(productValue)) {
    return NextResponse.json({ error: "Choose a supported Google product." }, { status: 400 });
  }
  const googleNodeByProduct: Record<string, string> = {
    gmail: "gmail", sheets: "sheets", drive: "google_drive", calendar: "google_calendar",
    docs: "google_docs", forms: "google_forms", youtube: "youtube", contacts: "google_contacts",
  };
  const expectedNode = googleNodeByProduct[productValue];
  const requestedNode = request.nextUrl.searchParams.get("node");
  const allowedNodeAliases: Record<string, string[]> = { sheets: ["sheets", "google_sheets"] };
  const allowedNodes = allowedNodeAliases[productValue] ?? [expectedNode];
  if (requestedNode && !allowedNodes.includes(requestedNode)) {
    return NextResponse.json({ error: "The selected Google node does not match this OAuth product." }, { status: 400 });
  }
  const nodeId = requestedNode ?? expectedNode;

  try {
    const workspace = await getOrCreateDefaultWorkspace(supabase);
    const { data: membership, error: membershipError } = await supabase.from("workspace_members")
      .select("role").eq("workspace_id", workspace.id).eq("user_id", user.id).maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership || !["owner", "admin"].includes(membership.role)) {
      return NextResponse.json({ error: "Only workspace owners and admins can connect Google accounts." }, { status: 403 });
    }
    const connectionId = request.nextUrl.searchParams.get("connectionId") ?? undefined;
    if (connectionId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(connectionId)) {
      return NextResponse.json({ error: "The Google connection ID is invalid." }, { status: 400 });
    }
    if (connectionId) {
      const admin = createAdminClient();
      const { data: selected, error: lookupError } = await admin.from("google_connections").select("id")
        .eq("id", connectionId).eq("workspace_id", workspace.id).eq("provider", "google").eq("product", productValue).maybeSingle();
      if (lookupError) throw lookupError;
      if (!selected) return NextResponse.json({ error: "The selected Google account was not found in this workspace." }, { status: 404 });
    }
    const config = getGoogleOAuthConfig();
    const requestOrigin = request.nextUrl.origin;
    const redirectOrigin = new URL(config.redirectUri).origin;
    if (requestOrigin !== redirectOrigin) {
      console.warn("[google-oauth] Preview origin differs from configured OAuth callback origin", { requestHost: request.nextUrl.host, callbackHost: new URL(config.redirectUri).host });
      return NextResponse.redirect(new URL("/dashboard/connections?google=redirect_uri_host_mismatch", request.url));
    }
    const state = base64url(randomBytes(32));
    const verifier = base64url(randomBytes(48));
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const scopes = ["openid", "email", "profile", ...GOOGLE_PRODUCTS[productValue].scopes];

    const authorize = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authorize.searchParams.set("client_id", config.clientId);
    authorize.searchParams.set("redirect_uri", config.redirectUri);
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("scope", scopes.join(" "));
    authorize.searchParams.set("access_type", "offline");
    authorize.searchParams.set("include_granted_scopes", "false");
    authorize.searchParams.set("prompt", "select_account consent");
    authorize.searchParams.set("state", state);
    authorize.searchParams.set("code_challenge", challenge);
    authorize.searchParams.set("code_challenge_method", "S256");

    const response = NextResponse.redirect(authorize);
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      path: "/api/integrations/google",
      maxAge: 600,
    };
    response.cookies.set("aivanta_google_oauth_state", state, cookieOptions);
    response.cookies.set("aivanta_google_oauth_verifier", verifier, cookieOptions);
    response.cookies.set("aivanta_google_oauth_product", productValue, cookieOptions);
    response.cookies.set("aivanta_google_oauth_user", user.id, cookieOptions);
    response.cookies.set("aivanta_google_oauth_node", nodeId, cookieOptions);
    response.cookies.set("aivanta_google_oauth_connection", connectionId ?? "", cookieOptions);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return NextResponse.redirect(new URL("/dashboard/connections?google=not_configured", request.url));
  }
}
