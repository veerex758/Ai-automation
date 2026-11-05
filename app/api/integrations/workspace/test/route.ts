import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
import { decryptWorkspaceCredentials } from "@/lib/integrations/workspace-credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TESTABLE = new Set(["openai", "gemini", "slack", "notion", "hubspot", "twilio", "shopify", "stripe", "linear", "elevenlabs", "stability_ai", "hugging_face", "pinecone", "microsoft_teams", "salesforce", "pipedrive", "zoho_crm", "freshsales", "close", "apollo", "intercom", "jira", "asana", "trello", "clickup", "monday", "todoist", "airtable", "bitbucket", "netlify", "woocommerce", "paypal", "paddle", "lemon_squeezy", "square", "razorpay", "zoom", "cal_com", "twilio_voice", "docusign", "x_twitter", "linkedin", "facebook_pages", "instagram", "tiktok", "mailchimp", "typeform"]);
type Provider = "openai" | "gemini" | "slack" | "notion" | "hubspot" | "twilio" | "shopify" | "stripe" | "linear" | "elevenlabs" | "stability_ai" | "hugging_face" | "pinecone" | "microsoft_teams" | "salesforce" | "pipedrive" | "zoho_crm" | "freshsales" | "close" | "apollo" | "intercom" | "jira" | "asana" | "trello" | "clickup" | "monday" | "todoist" | "airtable" | "bitbucket" | "netlify" | "woocommerce" | "paypal" | "paddle" | "lemon_squeezy" | "square" | "razorpay" | "zoom" | "cal_com" | "twilio_voice" | "docusign" | "x_twitter" | "linkedin" | "facebook_pages" | "instagram" | "tiktok" | "mailchimp" | "typeform";
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
      case "elevenlabs":
        url = "https://api.elevenlabs.io/v1/user";
        headers["xi-api-key"] = required(c, "apiKey");
        break;
      case "stability_ai":
        url = "https://api.stability.ai/v1/user/account";
        headers.Authorization = "Bearer " + required(c, "apiKey");
        break;
      case "hugging_face":
        url = "https://huggingface.co/api/whoami-v2";
        headers.Authorization = "Bearer " + required(c, "apiKey");
        break;
      case "pinecone": {
        const host = required(c, "indexHost");
        let parsed: URL;
        try { parsed = new URL(host.startsWith("https://") ? host : "https://" + host); } catch { throw new Error("CREDENTIAL_FIELD_INVALID"); }
        if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".pinecone.io") || parsed.username || parsed.password) throw new Error("CREDENTIAL_FIELD_INVALID");
        url = parsed.origin + "/describe_index_stats"; method = "POST";
        headers["Api-Key"] = required(c, "apiKey"); headers["Content-Type"] = "application/json";
        body = "{}";
        break;
      }
      case "microsoft_teams":
        url = "https://graph.microsoft.com/v1.0/me";
        headers.Authorization = "Bearer " + required(c, "accessToken");
        break;
      case "salesforce": {
        const instance = required(c, "instanceUrl");
        let parsed: URL;
        try { parsed = new URL(instance); } catch { throw new Error("CREDENTIAL_FIELD_INVALID"); }
        if (parsed.protocol !== "https:" || parsed.username || parsed.password || !(parsed.hostname.endsWith(".salesforce.com") || parsed.hostname.endsWith(".force.com"))) throw new Error("CREDENTIAL_FIELD_INVALID");
        url = parsed.origin + "/services/data/v60.0/limits";
        headers.Authorization = "Bearer " + required(c, "accessToken");
        break;
      }
      case "pipedrive":
        url = "https://api.pipedrive.com/v1/users/me";
        headers.Authorization = "Bearer " + required(c, "accessToken");
        break;
      case "zoho_crm":
        url = "https://www.zohoapis.com/crm/v6/users?type=CurrentUser";
        headers.Authorization = "Zoho-oauthtoken " + required(c, "accessToken");
        break;
      case "freshsales": {
        const domain = required(c, "domain");
        if (!/^[a-z0-9-]+\.myfreshworks\.com$/i.test(domain)) throw new Error("CREDENTIAL_FIELD_INVALID");
        url = "https://" + domain + "/crm/sales/api/contacts/filters";
        headers.Authorization = "Token token=" + required(c, "accessToken");
        break;
      }
      case "close":
        url = "https://api.close.com/api/v1/me/";
        headers.Authorization = "Basic " + Buffer.from(required(c, "apiKey") + ":").toString("base64");
        break;
      case "apollo":
        url = "https://api.apollo.io/api/v1/auth/health";
        headers["x-api-key"] = required(c, "apiKey");
        break;
      case "intercom":
        url = "https://api.intercom.io/me";
        headers.Authorization = "Bearer " + required(c, "accessToken");
        headers["Intercom-Version"] = "2.11";
        break;
      case "jira": {
        const site = required(c, "siteUrl");
        let parsed: URL; try { parsed = new URL(site); } catch { throw new Error("CREDENTIAL_FIELD_INVALID"); }
        if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".atlassian.net") || parsed.username || parsed.password) throw new Error("CREDENTIAL_FIELD_INVALID");
        url = parsed.origin + "/rest/api/3/myself";
        headers.Authorization = "Basic " + Buffer.from(required(c, "email") + ":" + required(c, "apiToken")).toString("base64");
        break;
      }
      case "asana":
        url = "https://app.asana.com/api/1.0/users/me";
        headers.Authorization = "Bearer " + required(c, "accessToken");
        break;
      case "trello": {
        const trello = new URL("https://api.trello.com/1/members/me");
        trello.searchParams.set("key", required(c, "apiKey")); trello.searchParams.set("token", required(c, "token"));
        url = trello.toString();
        break;
      }
      case "clickup":
        url = "https://api.clickup.com/api/v2/user";
        headers.Authorization = required(c, "token");
        break;
      case "monday":
        url = "https://api.monday.com/v2"; method = "POST";
        headers.Authorization = required(c, "apiToken"); headers["Content-Type"] = "application/json";
        body = JSON.stringify({ query: "{ me { id name } }" });
        break;
      case "todoist":
        url = "https://api.todoist.com/rest/v2/projects";
        headers.Authorization = "Bearer " + required(c, "accessToken");
        break;
      case "airtable":
        url = "https://api.airtable.com/v0/meta/whoami";
        headers.Authorization = "Bearer " + required(c, "accessToken");
        break;
      case "bitbucket":
        url = "https://api.bitbucket.org/2.0/user";
        headers.Authorization = "Bearer " + required(c, "accessToken");
        break;
      case "netlify":
        url = "https://api.netlify.com/api/v1/user";
        headers.Authorization = "Bearer " + required(c, "token");
        break;
      case "woocommerce": {
        const store = required(c, "storeUrl");
        let parsed: URL; try { parsed = new URL(store); } catch { throw new Error("CREDENTIAL_FIELD_INVALID"); }
        if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hostname === "localhost" || parsed.hostname.endsWith(".local")) throw new Error("CREDENTIAL_FIELD_INVALID");
        url = parsed.origin + "/wp-json/wc/v3/system_status";
        headers.Authorization = "Basic " + Buffer.from(required(c, "consumerKey") + ":" + required(c, "consumerSecret")).toString("base64");
        break;
      }
      case "paypal": {
        const env = required(c, "environment");
        if (env !== "sandbox" && env !== "live") throw new Error("CREDENTIAL_FIELD_INVALID");
        url = (env === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com") + "/v1/oauth2/token";
        method = "POST"; headers.Authorization = "Basic " + Buffer.from(required(c, "clientId") + ":" + required(c, "clientSecret")).toString("base64");
        headers["Content-Type"] = "application/x-www-form-urlencoded"; body = "grant_type=client_credentials";
        break;
      }
      case "paddle":
        url = "https://api.paddle.com/customers?per_page=1";
        headers.Authorization = "Bearer " + required(c, "apiKey"); headers["Paddle-Version"] = "1";
        break;
      case "lemon_squeezy":
        url = "https://api.lemonsqueezy.com/v1/stores/" + encodeURIComponent(required(c, "storeId"));
        headers.Authorization = "Bearer " + required(c, "apiKey"); headers.Accept = "application/vnd.api+json";
        break;
      case "square": {
        const env = required(c, "environment");
        if (env !== "sandbox" && env !== "production") throw new Error("CREDENTIAL_FIELD_INVALID");
        url = (env === "sandbox" ? "https://connect.squareupsandbox.com" : "https://connect.squareup.com") + "/v2/locations";
        headers.Authorization = "Bearer " + required(c, "accessToken");
        break;
      }
      case "razorpay":
        url = "https://api.razorpay.com/v1/customers?count=1";
        headers.Authorization = "Basic " + Buffer.from(required(c, "keyId") + ":" + required(c, "keySecret")).toString("base64");
        break;
      case "zoom":
        url = "https://api.zoom.us/v2/users/me";
        headers.Authorization = "Bearer " + required(c, "accessToken");
        break;
      case "cal_com":
        url = "https://api.cal.com/v2/me";
        headers.Authorization = "Bearer " + required(c, "apiKey");
        headers["cal-api-version"] = "2024-08-13";
        break;
      case "twilio_voice": {
        const sid = required(c, "accountSid");
        if (!/^AC[a-f0-9]{32}$/i.test(sid)) throw new Error("CREDENTIAL_FIELD_INVALID");
        url = "https://api.twilio.com/2010-04-01/Accounts/" + encodeURIComponent(sid) + ".json";
        headers.Authorization = "Basic " + Buffer.from(sid + ":" + required(c, "authToken")).toString("base64");
        break;
      }
      case "docusign": {
        const base = required(c, "baseUri");
        let parsed: URL; try { parsed = new URL(base); } catch { throw new Error("CREDENTIAL_FIELD_INVALID"); }
        if (parsed.protocol !== "https:" || (!parsed.hostname.endsWith(".docusign.net") && !parsed.hostname.endsWith(".docusign.com"))) throw new Error("CREDENTIAL_FIELD_INVALID");
        url = parsed.origin + "/restapi/v2.1/accounts/" + encodeURIComponent(required(c, "accountId"));
        headers.Authorization = "Bearer " + required(c, "accessToken");
        break;
      }
      case "x_twitter":
        url = "https://api.x.com/2/users/me";
        headers.Authorization = "Bearer " + required(c, "accessToken");
        break;
      case "linkedin":
        url = "https://api.linkedin.com/v2/userinfo";
        headers.Authorization = "Bearer " + required(c, "accessToken");
        break;
      case "facebook_pages":
        url = "https://graph.facebook.com/v22.0/" + encodeURIComponent(required(c, "pageId")) + "?fields=id,name";
        headers.Authorization = "Bearer " + required(c, "pageAccessToken");
        break;
      case "instagram":
        url = "https://graph.facebook.com/v22.0/" + encodeURIComponent(required(c, "igUserId")) + "?fields=id,username";
        headers.Authorization = "Bearer " + required(c, "accessToken");
        break;
      case "tiktok":
        url = "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name";
        method = "POST"; headers.Authorization = "Bearer " + required(c, "accessToken");
        headers["Content-Type"] = "application/json"; body = JSON.stringify({ fields: ["open_id", "display_name"] });
        break;
      case "mailchimp": {
        const key = required(c, "apiKey"), region = key.split("-").pop() ?? "";
        if (!/^us\d{1,2}$/.test(region)) throw new Error("CREDENTIAL_FIELD_INVALID");
        url = "https://" + region + ".api.mailchimp.com/3.0/ping";
        headers.Authorization = "Basic " + Buffer.from("aivanta:" + key).toString("base64");
        break;
      }
      case "typeform":
        url = "https://api.typeform.com/me";
        headers.Authorization = "Bearer " + required(c, "accessToken");
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
