import { randomBytes, createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getGoogleOAuthConfig, GOOGLE_PRODUCTS, isGoogleProduct } from "@/lib/integrations/google-oauth";

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
    return NextResponse.json({ error: "Choose a supported Google product: gmail or sheets." }, { status: 400 });
  }

  try {
    const config = getGoogleOAuthConfig();
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
    authorize.searchParams.set("prompt", "consent");
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
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return NextResponse.redirect(new URL("/dashboard/connections?google=not_configured", request.url));
  }
}
