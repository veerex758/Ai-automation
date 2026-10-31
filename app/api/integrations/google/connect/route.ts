import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";

export const dynamic = "force-dynamic";
const COOKIE = "aivanta_google_oauth_state";
const scopes = {
  gmail: ["openid", "email", "https://www.googleapis.com/auth/gmail.readonly"],
  sheets: ["openid", "email", "https://www.googleapis.com/auth/spreadsheets.readonly"],
} as const;

function signature(value: string) {
  const secret = process.env.AIVANTA_CREDENTIALS_ENCRYPTION_KEY;
  if (!secret) throw new Error("GOOGLE_OAUTH_STATE_SECRET_MISSING");
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export async function GET(request: NextRequest) {
  try {
    const product = request.nextUrl.searchParams.get("product");
    if (product !== "gmail" && product !== "sheets") {
      return NextResponse.json({ error: "Choose Gmail or Google Sheets." }, { status: 400 });
    }
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;
    if (!clientId || !redirectUri || !process.env.AIVANTA_CREDENTIALS_ENCRYPTION_KEY) {
      return NextResponse.json({ error: "Google OAuth is not configured on this environment." }, { status: 503 });
    }
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.redirect(new URL("/login?next=%2Fdashboard%2Fintegrations", request.url));
    const workspace = await getOrCreateDefaultWorkspace(supabase);
    const { data: membership } = await supabase.from("workspace_members").select("role")
      .eq("workspace_id", workspace.id).eq("user_id", user.id).maybeSingle();
    if (!membership || !["owner", "admin"].includes(membership.role)) {
      return NextResponse.json({ error: "Only workspace owners and admins can connect Google accounts." }, { status: 403 });
    }
    const nonce = randomBytes(32).toString("base64url");
    const issuedAt = Date.now().toString();
    const payload = [workspace.id, product, issuedAt, nonce].join(".");
    const state = payload + "." + signature(payload);
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: clientId, redirect_uri: redirectUri, response_type: "code",
      scope: scopes[product].join(" "), access_type: "offline", prompt: "consent",
      include_granted_scopes: "false", state,
    }).toString();
    const response = NextResponse.redirect(url);
    response.cookies.set(COOKIE, state, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/integrations/google", maxAge: 600 });
    return response;
  } catch {
    return NextResponse.json({ error: "Could not start Google authorization." }, { status: 500 });
  }
}

export { COOKIE as GOOGLE_OAUTH_STATE_COOKIE, signature as signGoogleOAuthState };
