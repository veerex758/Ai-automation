import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
import {
  createOAuthState,
  createProviderAuthorizeUrl,
  PROVIDER_OAUTH_CONFIG,
} from "@/lib/integrations/provider-oauth";

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
    const redirectUri = new URL("/api/integrations/oauth/" + encodeURIComponent(provider) + "/callback", request.url).toString();
    const { state, codeVerifier } = createOAuthState({ provider, workspaceId: workspace.id, userId: user.id });
    const authorizeUrl = createProviderAuthorizeUrl({ provider, config, redirectUri, state, codeVerifier });
    const response = NextResponse.redirect(authorizeUrl);
    response.cookies.set("aivanta_oauth_" + provider, state, {
      httpOnly: true,
      secu¶»§q«^