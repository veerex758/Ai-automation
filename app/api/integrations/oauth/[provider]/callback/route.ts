import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { encryptWorkspaceCredentials } from "@/lib/integrations/workspace-credentials";
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
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax",
    path: "/api/integrations/oauth/" + provider + "/callback", maxAge: 0,
  });
  return response;
}

e¶»§q«^