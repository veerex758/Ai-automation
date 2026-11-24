import { NextResponse, type NextRequest } from "next/server";
import { getAdminSupabaseConfig } from "@/lib/supabase/admin";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
import { decryptWorkspaceCredentials } from "@/lib/integrations/workspace-credentials";
import { enforceDistributedRateLimit } from "@/lib/security/distributed-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function senderDomain(fromEmail: string) {
  const match = /@([^>\s]+)>?$/.exec(fromEmail.trim());
  return match?.[1]?.toLowerCase() ?? null;
}

export async function POST(request: NextRequest) {
  let workspaceId: string | null = null;
  let integrationId: string | null = null;
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json({ error: "Authentication required." }, 401);

    const body = await request.json().catch(() => null) as { connectionId?: unknown } | null;
    const requestedConnectionId = typeof body?.connectionId === "string" ? body.connectionId : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedConnectionId)) {
      return json({ error: "Choose a saved Resend connection to test." }, 400);
    }
    const workspace = await getOrCreateDefaultWorkspace(supabase);
    workspaceId = workspace.id;
    const { data: membership, error: membershipError } = await supabase.from("workspace_members")
      .select("role").eq("workspace_id", workspace.id).eq("user_id", user.id).maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership || !["owner", "admin"].includes(membership.role)) {
      return json({ error: "Only workspace owners and admins can test integrations." }, 403);
    }

    const rateLimit = await enforceDistributedRateLimit(request, {
      scope: "resend-connection-test", windowMs: 5 * 60_000,
      ipLimit: 8, userId: user.id, userLimit: 8,
      workspaceId: workspace.id, workspaceLimit: 20,
      resourceId: requestedConnectionId, resourceLimit: 3,
    });
    if (rateLimit) return rateLimit;
    const db = serviceClient();
    const { data: integration, error: integrationError } = await db.from("workspace_integrations")
      .select("id,display_name").eq("id", requestedConnectionId).eq("workspace_id", workspace.id).eq("provider", "resend").maybeSingle();
    if (integrationError) throw integrationError;
    if (!integration) return json({ error: "Save your Resend connection before testing it." }, 404);
    const { error: invalidateError } = await db.from("workspace_integrations").update({
      status: "needs_attention", last_tested_at: null, last_test_status: null,
    }).eq("id", integration.id).eq("workspace_id", workspace.id);
    if (invalidateError) throw invalidateError;
    integrationId = integration.id;

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
      return json({ error: "Aivanta could not decrypt this saved credential. Check the workspace encryption key and save the connection again if it changed." }, 503);
    }
    const apiKey = credentials?.apiKey;
    const fromEmail = credentials?.fromEmail;
    if (!apiKey || !fromEmail) return json({ error: "The saved Resend connection is missing its API key or sender address." }, 422);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let response: Response;
    try {
      response = await fetch("https://api.resend.com/domains?limit=100", {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}`, "User-Agent": "Aivanta/0.1", Accept: "application/json" },
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "AbortError";
      await db.from("workspace_integrations").update({
        status: "needs_attention", last_tested_at: new Date().toISOString(), last_test_status: "failed",
      }).eq("id", integration.id).eq("workspace_id", workspace.id);
      return json({ error: timedOut ? "Resend did not respond within 8 seconds. Check the connection and try again." : "Aivanta could not reach Resend. Check the server network and try again." }, 502);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const status = response.status;
      const message = status === 401
        ? "Resend rejected this API key. Check the key and save the correct one."
        : status === 403
          ? "Resend denied access to domain listing. This can happen with a Sending access key and does not by itself mean the key is invalid. Use the explicit Send test email action in Connections to verify sending access."
          : status === 429
            ? "Resend rate-limited the connection check. Wait a moment and try again."
            : "Resend could not complete the connection check.";
      await db.from("workspace_integrations").update({
        status: "needs_attention", last_tested_at: new Date().toISOString(), last_test_status: "failed",
      }).eq("id", integration.id).eq("workspace_id", workspace.id);
      return json({ error: message }, status === 429 ? 429 : 502);
    }

    let payload: unknown;
    try { payload = await response.json(); } catch {
      await db.from("workspace_integrations").update({
        status: "needs_attention", last_tested_at: new Date().toISOString(), last_test_status: "failed",
      }).eq("id", integration.id);
      return json({ error: "Resend returned an invalid response. Try again." }, 502);
    }
    const domains = payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: Array<{ name?: unknown; status?: unknown }> }).data : [];
    const domain = senderDomain(fromEmail);
    const match = domain ? domains.find(item => typeof item.name === "string" && item.name.toLowerCase() === domain) : undefined;
    const verified = match?.status === "verified";

    const { error: updateError } = await db.from("workspace_integrations").update({
      status: verified ? "connected" : "needs_attention",
      last_tested_at: new Date().toISOString(),
      last_test_status: "passed",
      metadata: {
        senderDomain: domain,
        senderDomainStatus: typeof match?.status === "string" ? match.status : "not_found",
        credentialCheck: "passed",
      },
    }).eq("id", integration.id);
    if (updateError) throw updateError;

    return json({
      status: "passed",
      credentialValid: true,
      senderDomainVerified: Boolean(verified),
      senderDomainStatus: typeof match?.status === "string" ? match.status : "not_found",
      message: verified
        ? "Resend authenticated successfully and the sender domain is verified. No email was sent."
        : "Resend authenticated successfully, but the sender domain is not verified or was not found. No email was sent.",
    });
  } catch {
    if (integrationId) {
      try {
        const db = serviceClient();
        await db.from("workspace_integrations").update({
          last_tested_at: new Date().toISOString(), last_test_status: "failed",
        }).eq("id", integrationId).eq("workspace_id", workspaceId);
      } catch { /* preserve the sanitized response */ }
    }
    return json({ error: "Could not complete the Resend connection check. No email was sent." }, 500);
  }
}
