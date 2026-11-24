import { NextResponse, type NextRequest } from "next/server";
import { getAdminSupabaseConfig } from "@/lib/supabase/admin";
import { randomUUID } from "node:crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
import { decryptWorkspaceCredentials } from "@/lib/integrations/workspace-credentials";
import { enforceDistributedRateLimit } from "@/lib/security/distributed-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// This endpoint sends only to the authenticated, verified workspace member's
// email address. The browser cannot choose a recipient or sender.
const TEST_SENDER = "onboarding@resend.dev";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

function serviceClient() {
  let config: ReturnType<typeof getAdminSupabaseConfig>;
  try { config = getAdminSupabaseConfig(); }
  catch { throw new Error("INTEGRATION_DATABASE_NOT_CONFIGURED"); }
  return createSupabaseClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json({ error: "Authentication required." }, 401);
    if (!user.email || !user.email_confirmed_at) {
      return json({ error: "Verify your account email before sending a Resend setup test." }, 409);
    }
    const testRecipient = user.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testRecipient)) {
      return json({ error: "The verified account email is not a valid test recipient." }, 409);
    }

    const body = await request.json().catch(() => null) as { connectionId?: unknown } | null;
    const requestedConnectionId = typeof body?.connectionId === "string" ? body.connectionId : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedConnectionId)) {
      return json({ error: "Choose a saved Resend connection before sending a test email." }, 400);
    }
    const workspace = await getOrCreateDefaultWorkspace(supabase);
    const { data: membership, error: membershipError } = await supabase.from("workspace_members")
      .select("role").eq("workspace_id", workspace.id).eq("user_id", user.id).maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership || !["owner", "admin"].includes(membership.role)) {
      return json({ error: "Only workspace owners and admins can send a test email." }, 403);
    }

    const rateLimit = await enforceDistributedRateLimit(request, {
      scope: "resend-test-email", windowMs: 60 * 60_000,
      ipLimit: 3, userId: user.id, userLimit: 3,
      workspaceId: workspace.id, workspaceLimit: 10,
      resourceId: requestedConnectionId, resourceLimit: 3,
    });
    if (rateLimit) return rateLimit;
    const db = serviceClient();
    const { data: integration, error: integrationError } = await db.from("workspace_integrations")
      .select("id").eq("id", requestedConnectionId).eq("workspace_id", workspace.id).eq("provider", "resend").maybeSingle();
    if (integrationError) throw integrationError;
    if (!integration) return json({ error: "Save your Resend connection before sending a test email." }, 404);

    const { data: secret, error: secretError } = await db.from("workspace_integration_secrets")
      .select("encrypted_credentials,encryption_version").eq("integration_id", integration.id).maybeSingle();
    if (secretError) throw secretError;
    if (!secret?.encrypted_credentials || !["v1", "v2", "v3"].includes(secret.encryption_version)) return json({ error: "The saved Resend credential is unavailable. Save the connection again." }, 409);

    let credentials: Record<string, string>;
    try {
      const associatedData = ["v2", "v3"].includes(secret.encryption_version) ? `${workspace.id}:resend:${integration.id}` : `${workspace.id}:resend`;
      const decrypted = decryptWorkspaceCredentials(secret.encrypted_credentials, undefined, associatedData);
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
          "Idempotency-Key": `aivanta-resend-setup-test-${workspace.id}-${integration.id}-${user.id}-${randomUUID()}`,
        },
        body: JSON.stringify({
          from: TEST_SENDER,
          to: [testRecipient],
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
      recipient: testRecipient,
      sender: TEST_SENDER,
      emailId: typeof payload.id === "string" ? payload.id : null,
      message: "Resend accepted the test email for delivery to your verified account email. No workflow was executed.",
    });
  } catch {
    return json({ error: "Could not send the Resend test email. No workflow was executed." }, 500);
  }
}
