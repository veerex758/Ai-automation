import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
import { decryptWorkspaceCredentials } from "@/lib/integrations/workspace-credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TESTABLE = new Set(["openai", "gemini", "slack", "notion", "hubspot", "twilio", "shopify", "stripe", "linear", "elevenlabs", "stability_ai", "hugging_face", "pinecone"]);
type Provider = "openai" | "gemini" | "slack" | "notion" | "hubspot" | "twilio" | "shopify" | "stripe" | "linear" | "elevenlabs" | "stability_ai" | "hugging_face" | "pinecone";
type Credentials = Record<string, string>;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}
function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("INTEGRATION_DATABASE_NOT_CONFIGURED");
  return createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
function required(credentials: Credentials, key: string) {
  const value = credentials[key]?.trim();
  if (!value) throw new Error("CREDENTIAL_FIELD_MISSING");
  return value;
}
async function check(provider: Provider, c: Credentials) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    let url = "";
    const headers: Record<string, string> = {};
    let method: "GET" | "POST" = "GET", body: string | undefined;
    switch (provider) {
      case "openai":
        url = "https://api.openai.com/v1/models";
        headers.Authorization = "Bearer " + required(c, "apiKey");
        break;
      case "gemini":
        url = "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1";
        headers["x-goog-api-key"] = required(c, "apiKey");
        break;
      case "slack": {
        // Incoming webhooks are write-only: validating one requires posting a message.
        // Never send a surprise message from a read-only "Test connection" control.
        if (!c.botToken?.trim()) {
          if (c.webhookUrl?.trim()) {
            return { ok: false, message: "This Slack connection uses an incoming webhook. A safe read-only test is not supported; no message was sent. Use a bot token for connection testing.", status: 409 };
          }
          throw new Error("CREDENTIAL_FIELD_MISSING");
        }
        url = "https://slack.com/api/auth.test";
        headers.Authorization = "Bearer " + required(c, "botToken");
        break;
      }
      case "notion":
        url = "https://api.notion.com/v1/users/me";
        headers.Authorization = "Bearer " + required(c, "apiKey");
        headers["Notion-Version"] = "2022-06-28";
        break;
      case "hubspot":
        url = "https://api.hubapi.com/account-info/v3/details";
        headers.Authorization = "Bearer " + required(c, "accessToken");
        break;
      case "twilio": {
        const sid = required(c, "accountSid"), token = required(c, "authToken");
        if (!/^AC[a-f0-9]{32}$/i.test(sid)) throw new Error("CREDENTIAL_FIELD_INVALID");
        url = "https://api.twilio.com/2010-04-01/Accounts/" + encodeURIComponent(sid) + ".json";
        headers.Authorization = "Basic " + Buffer.from(sid + ":" + token).toString("base64");
        break;
      }
      case "shopify":
        const shop = required(c, "shopDomain");
        if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop)) throw new Error("CREDENTIAL_FIELD_INVALID");
        url = "https://" + shop + "/admin/api/2025-10/shop.json";
        headers["X-Shopify-Access-Token"] = required(c, "accessToken");
        break;
      case "stripe":
        url = "https://api.stripe.com/v1/account";
        headers.Authorization = "Bearer " + required(c, "secretKey");
        break;
      case "linear":
        url = "https://api.linear.app/graphql"; method = "POST";
        headers.Authorization = required(c, "apiKey"); headers["Content-Type"] = "application/json";
        body = JSON.stringify({ query: "{ viewer { id name } }" });
        break;
    }
    const response = await fetch(url, { method, headers, body, cache: "no-store", redirect: "error", signal: controller.signal });
    if (!response.ok) {
      const status = response.status;
      return { ok: false, message: status === 401 ? "Provider rejected the saved credential." : status === 403 ? "Credential lacks permission for this read-only connection check." : status === 429 ? "Provider rate-limited the check. Try again shortly." : "Provider connection check failed." , status };
    }
    let data: unknown = {};
    try { data = await response.json(); } catch { /* some APIs return empty success bodies */ }
    if (provider === "slack" && (data as { ok?: unknown })?.ok !== true) return { ok: false, message: "Slack rejected the credential or required scopes.", status: 200 };
    if (provider === "linear" && !(data as { data?: { viewer?: { id?: unknown } } })?.data?.viewer?.id) return { ok: false, message: "Linear could not validate the API key.", status: 200 };
    return { ok: true, message: "Credential authenticated. Aivanta performed a read-only connection check.", status: response.status };
  } finally { clearTimeout(timer); }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json({ error: "Authentication required." }, 401);
    let input: unknown;
    try { input = await request.json(); } catch { return json({ error: "Invalid JSON body." }, 400); }
    const provider = input && typeof input === "object" ? (input as { provider?: unknown }).provider : undefined;
    if (typeof provider !== "string" || !TESTABLE.has(provider)) return json({ error: "This provider does not support a credential test here." }, 400);
    const workspace = await getOrCreateDefaultWorkspace(supabase);
    const { data: membership, error: membershipError } = await supabase.from("workspace_members").select("role")
      .eq("workspace_id", workspace.id).eq("user_id", user.id).maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership || !["owner", "admin"].includes(membership.role)) return json({ error: "Only workspace owners and admins can test integrations." }, 403);
    const db = serviceClient();
    const { data: integration, error: integrationError } = await db.from("workspace_integrations").select("id")
      .eq("workspace_id", workspace.id).eq("provider", provider).maybeSingle();
    if (integrationError) throw integrationError;
    if (!integration) return json({ error: "Save this integration before testing it." }, 404);
    const { data: secret, error: secretError } = await db.from("workspace_integration_secrets").select("encrypted_credentials,encryption_version")
      .eq("integration_id", integration.id).maybeSingle();
    if (secretError) throw secretError;
    if (!secret?.encrypted_credentials || secret.encryption_version !== "v1") return json({ error: "Saved credential is unavailable. Save the integration again." }, 409);
    let credentials: Credentials;
    try { credentials = decryptWorkspaceCredentials(secret.encrypted_credentials, undefined, workspace.id + ":" + provider)[provider as Provider]; }
    catch { return json({ error: "Aivanta could not decrypt this credential. Check the encryption key and save it again if it changed." }, 503); }
    if (!credentials) return json({ error: "Saved credential does not match this provider." }, 409);
    const result = await check(provider as Provider, credentials);
    const update = await db.from("workspace_integrations").update({
      status: result.ok ? "connected" : "needs_attention",
      last_tested_at: new Date().toISOString(), last_test_status: result.ok ? "passed" : "failed",
    }).eq("id", integration.id).eq("workspace_id", workspace.id);
    if (update.error) throw update.error;
    return json(result, result.ok ? 200 : result.status === 409 ? 409 : result.status === 429 ? 429 : 502);
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return json({ error: timedOut ? "Provider timed out after 8 seconds." : "Could not complete the integration check." }, timedOut ? 504 : 500);
  }
}
