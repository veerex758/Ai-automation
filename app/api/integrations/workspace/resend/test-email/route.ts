import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
import { decryptWorkspaceCredentials } from "@/lib/integrations/workspace-credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// This endpoint is deliberately fixed to Resend's test sender and the account
// email explicitly approved for this one-time setup test. Never accept a
// recipient or sender from the browser.
const TEST_SENDER = "onboarding@resend.dev";
const TEST_RECIPIENT = "sundayezekielm069@gmail.com";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("INTEGRATION_DATABASE_NOT_CONFIGURED");
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export async function POST(_request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json({ error: "Authentication required." }, 401);

    const workspace = await getOrCreateDefaultWorkspace(supabase);
    const { data: membership, error: membershipError } = await supabase.from("workspace_members")
      .select("role").eq("workspace_id", workspace.id).eq("user_id", user.id).maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership || !["owner", "admin"].includes(membership.role)) {
      return json({ error: "Only workspace owners and admins can send a test email." }, 403);
    }

    const db = serviceClient();
    const { data: integration, error: integrationError } = await db.from("workspace_integrations")
      .select("id").eq("workspace_id", workspace.id).eq("provider", "resend").maybeSingle();
    if (integrationError) throw integrationError;
    if (!integration) return json({ error: "Save your Resend connection before sending a test email." }, 404);

    const { data: secret, error: secretError } = await db.from("workspace_integration_secrets")
      .select("encrypted_credentials").eq("integration_id", integration.id).maybeSingle();
    if (secretError) throw secretError;
    if (!secret?.encrypted_credentials) return json({ error: "The saved Resend credential is unavailable. Save the connection again." }, 409);

    let credentials: Record<string, string>;
    try {
      const decrypted = decryptWorkspaceCredentials(secret.encrypted_credentials, undefined, `${workspace.id}:resend`);
      credentials = decrypted.resend;
    } catch {
      return json({ error: "Aivanta could not decrypt this saved credential. Check the workspace encryption key." }, 503);
    }
    const apiKey = credentials?.apiKey;
    if (!apiKey) return json({ error: "The saved Resend connection is missing its API key." }, 422);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let response: Response;
    try {
      response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "User-Agent": "Aivanta/0.1",
          "Idempotency-Key": `aivanta-resend-setup-test-${workspace.id}`,
        },
        body: JSON.stringify({
          from: TEST_SENDER,
          to: [TEST_RECIPIENT],
          subject: "Aivanta · Resend connection test",
          text: "This is a one-time test email confirming that Aivanta can send through your Resend account. No workflow was executed.",
        }),
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "AbortError";
      return json({ error: timedOut ? "Resend did not respond within 10 seconds. Check Resend activity before retrying." : "Aivanta could not reach Resend. No delivery could be confirmed." }, 502);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const status = response.status;
      const message = status === 401
        ? "Resend rejected the saved API key. Reconnect Resend and try again."
        : status === 403
          ? "Resend rejected the test sender or recipient. Confirm this is the email address on your Resend account."
          : status === 429
            ? "Resend rate-limited the test. Wait before trying again."
            : "Resend could not accept the test email. Check the Resend dashboard for details.";
      return json({ error: message }, status === 429 ? 429 : 502);
    }

    let payload: { id?: unknown };
    try { payload = await response.json() as { id?: unknown }; } catch {
      return json({ error: "Resend accepted the request but returned an unreadable response. Check Resend activity before retrying." }, 502);
    }
    return json({
      status: "accepted",
      recipient: TEST_RECIPIENT,
      sender: TEST_SENDER,
      emailId: typeof payload.id === "string" ? payload.id : null,
      message: "Resend accepted the test email for delivery to your account address. No workflow was executed.",
    });
  } catch {
    return json({ error: "Could not send the Resend test email. No workflow was executed." }, 500);
  }
}
