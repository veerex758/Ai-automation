import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
import { createOAuthState, createProviderAuthorizeUrl, PROVIDER_OAUTH_CONFIG } from "@/lib/integrations/provider-oauth";
import { enforceDistributedRateLimit } from "@/lib/security/distributed-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  const { provider } = await context.params;
  const config = PROVIDER_OAUTH_CONFIG[provider];
  if (!config) return NextResponse.json({ error: "OAuth is not supported for this provider." }, { status: 404 });

  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    const workspace = await getOrCreateDefaultWorkspace(supabase);
    const { data: membership, error: membershipError } = await supabase.from("workspace_members")
      .select("role").eq("workspace_id", workspace.id).eq("user_id", user.id).maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership || !["owner", "admin"].includes(membership.role)) {
      return NextResponse.json({ error: "Only workspace owners and admins can connect provider accounts." }, { status: 403 });
    }
    const rateLimit = await enforceDistributedRateLimit(request, {
      scope: "provider-oauth-start", windowMs: 15 * 60_000,
      ipLimit: 10, userId: user.id, userLimit: 10,
      workspaceId: workspace.id, workspaceLimit: 30,
      resourceId: provider, resourceLimit: 10,
    });
    if (rateLimit) return rateLimit;
    const connectionId = request.nextUrl.searchParams.get("connectionId") ?? undefined;
    if (connectionId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(connectionId)) {
      return NextResponse.json({ error: "The connection ID is invalid." }, { status: 400 });
    }
    const callbackPath = "/api/integrations/oauth/" + encodeURIComponent(provider) + "/callback";
    const redirectUri = new URL(callbackPath, request.url).toString();
    const { state, codeVerifier } = createOAuthState({ provider, workspaceId: workspace.id, userId: user.id, ...(connectionId ? { connectionId } : {}) });
    const authorizeUrl = createProviderAuthorizeUrl({ provider, config, redirectUri, state, codeVerifier });
    const response = NextResponse.redirect(authorizeUrl);
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      path: callbackPath,
      maxAge: 10 * 60,
    };
    response.cookies.set("aivanta_oauth_" + provider, state, cookieOptions);
    response.cookies.set("aivanta_oauth_verifier_" + provider, codeVerifier, cookieOptions);
    return response;
  } catch (error) {
    const code = error instanceof Error ? error.message : "OAUTH_START_FAILED";
    return NextResponse.json({ error: code === "OAUTH_PROVIDER_NOT_CONFIGURED" || code === "OAUTH_STATE_SECRET_NOT_CONFIGURED"
      ? "OAuth provider configuration is incomplete." : "Unable to start provider authorization." }, { status: 503 });
  }
}
