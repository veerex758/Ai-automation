import { createHash, createHmac } from "node:crypto";
import { Pool } from "pg";
import { createConnection as createMysqlConnection } from "mysql2/promise";
import { MongoClient } from "mongodb";
import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
import { decryptWorkspaceCredentials, type WorkspaceCredentialProvider } from "@/lib/integrations/workspace-credentials";
import { performSafeHttpRequest } from "@/nodes/safe-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function signedS3Headers(url: URL, accessKeyId: string, secretAccessKey: string, region: string): Record<string, string> {
  const amzDate = new Date().toISOString().replace(/[:-]|\\.\\d{3}/g, "");
  const date = amzDate.slice(0, 8);
  const payloadHash = createHash("sha256").update("").digest("hex");
  const canonicalHeaders = "host:" + url.host + "\\n" + "x-amz-content-sha256:" + payloadHash + "\\n" + "x-amz-date:" + amzDate + "\\n";
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = ["GET", url.pathname, url.searchParams.toString(), canonicalHeaders, signedHeaders, payloadHash].join("\\n");
  const scope = date + "/" + region + "/s3/aws4_request";
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonicalRequest).digest("hex")].join("\\n");
  const hmac = (key: Buffer | string, value: string) => createHmac("sha256", key).update(value).digest();
  const signingKey = hmac(hmac(hmac(hmac("AWS4" + secretAccessKey, date), region), "s3"), "aws4_request");
  return { "x-amz-date": amzDate, "x-amz-content-sha256": payloadHash, Authorization: "AWS4-HMAC-SHA256 Credential=" + accessKeyId + "/" + scope + ", SignedHeaders=" + signedHeaders + ", Signature=" + createHmac("sha256", signingKey).update(stringToSign).digest("hex") };
}


const TESTABLE = new Set(["openai", "gemini", "claude", "http", "mistral", "groq", "perplexity", "discord", "telegram", "whatsapp_business", "sendgrid", "mailgun", "postmark", "github", "gitlab", "sentry", "vercel", "calendly", "zendesk", "freshdesk", "serpapi", "openweather", "slack", "notion", "hubspot", "twilio", "shopify", "stripe", "linear", "elevenlabs", "stability_ai", "hugging_face", "pinecone", "microsoft_teams", "salesforce", "pipedrive", "zoho_crm", "freshsales", "close", "apollo", "intercom", "jira", "asana", "trello", "clickup", "monday", "todoist", "airtable", "bitbucket", "netlify", "woocommerce", "paypal", "paddle", "lemon_squeezy", "square", "razorpay", "zoom", "cal_com", "twilio_voice", "docusign", "x_twitter", "linkedin", "facebook_pages", "instagram", "tiktok", "mailchimp", "typeform", "supabase", "postgresql", "mysql", "mongodb", "redis", "firebase", "dropbox", "aws_s3", "cloudflare_r2"]);
type Provider = WorkspaceCredentialProvider;
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
      case "resend":
        url = "https://api.resend.com/domains"; headers.Authorization = "Bearer " + required(c, "apiKey"); break;
      case "openai":
        url = "https://api.openai.com/v1/models";
        headers.Authorization = "Bearer " + required(c, "apiKey");
        break;
      case "gemini":
        url = "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1";
        headers["x-goog-api-key"] = required(c, "apiKey");
        break;
      case "claude":
        url = "https://api.anthropic.com/v1/models?limit=1";
        headers["x-api-key"] = required(c, "apiKey");
        headers["anthropic-version"] = "2023-06-01";
        break;
      case "http": {
        let target: URL;
        try { target = new URL(required(c, "baseUrl")); } catch { throw new Error("CREDENTIAL_FIELD_INVALID"); }
        if (target.protocol !== "https:" || target.username || target.password || target.hash) throw new Error("CREDENTIAL_FIELD_INVALID");
        const authHeaders: Record<string, string> = {};
        if (c.apiKey) authHeaders.Authorization = "Bearer " + c.apiKey;
        else if (c.username && c.password) authHeaders.Authorization = "Basic " + Buffer.from(c.username + ":" + c.password).toString("base64");
        else if (c.username || c.password) throw new Error("CREDENTIAL_FIELD_INVALID");
        const result = await performSafeHttpRequest({ url: target.toString(), method: "GET", headers: authHeaders, timeoutMs: 8000 });
        return result.status >= 200 && result.status < 300
          ? { ok: true, message: "HTTP endpoint returned a successful read-only response.", status: result.status }
          : { ok: false, message: "HTTP endpoint returned status " + result.status + ". Check the URL and authentication.", status: result.status };
      }
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
        url = "https://graph.facebook.com/v22.0/me?fields=id,name";
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
      case "supabase": {
        const project = new URL(required(c, "projectUrl"));
        if (project.protocol !== "https:" || !project.hostname.endsWith(".supabase.co")) throw new Error("CREDENTIAL_FIELD_INVALID");
        url = project.origin + "/rest/v1/";
        const key = required(c, "apiKey"); headers.apikey = key; headers.Authorization = "Bearer " + key;
        break;
      }
      case "mysql": {
        const connectionString = required(c, "connectionString");
        if (!/^mysql:\/\//i.test(connectionString)) throw new Error("CREDENTIAL_FIELD_INVALID");
        const parsed = new URL(connectionString);
        const connection = await createMysqlConnection({
          host: parsed.hostname, port: Number(parsed.port || 3306),
          user: decodeURIComponent(parsed.username), password: decodeURIComponent(parsed.password),
          database: decodeURIComponent(parsed.pathname.replace(/^\//, "")) || undefined,
          ssl: { rejectUnauthorized: true }, connectTimeout: 5000, multipleStatements: false,
        });
        try { await connection.query("SELECT 1"); } finally { await connection.end(); }
        return { ok: true, message: "MySQL connection verified over TLS.", status: 200 };
      }
      case "mongodb": {
        const connectionString = required(c, "connectionString");
        if (!/^mongodb(?:\+srv)?:\/\//i.test(connectionString)) throw new Error("CREDENTIAL_FIELD_INVALID");
        const client = new MongoClient(connectionString, { tls: true, tlsAllowInvalidCertificates: false, serverSelectionTimeoutMS: 5000, maxPoolSize: 1 });
        try { await client.connect(); await client.db().command({ ping: 1 }); } finally { await client.close(); }
        return { ok: true, message: "MongoDB connection verified over TLS.", status: 200 };
      }
      case "postgresql": {
        const connectionString = required(c, "connectionString");
        if (!/^postgres(?:ql)?:\/\//i.test(connectionString)) throw new Error("CREDENTIAL_FIELD_INVALID");
        const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000, ssl: { rejectUnauthorized: true } });
        try {
          const client = await pool.connect();
          try { await client.query("SELECT 1"); } finally { client.release(); }
        } finally { await pool.end(); }
        return NextResponse.json({ ok: true, message: "PostgreSQL connection verified." }, { headers: { "Cache-Control": "no-store" } });
      }
      case "redis": {
        const endpoint = new URL(required(c, "restUrl"));
        if (endpoint.protocol !== "https:" || !endpoint.hostname.endsWith(".upstash.io")) throw new Error("CREDENTIAL_FIELD_INVALID");
        url = endpoint.origin; method = "POST"; headers.Authorization = "Bearer " + required(c, "token");
        headers["Content-Type"] = "application/json"; body = JSON.stringify(["PING"]);
        break;
      }
      case "firebase": {
        const project = required(c, "projectId");
        if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project)) throw new Error("CREDENTIAL_FIELD_INVALID");
        url = "https://firestore.googleapis.com/v1/projects/" + encodeURIComponent(project) + "/databases/(default)/documents?pageSize=1";
        headers.Authorization = "Bearer " + required(c, "accessToken");
        break;
      }
      case "dropbox":
        url = "https://api.dropboxapi.com/2/users/get_current_account"; method = "POST";
        headers.Authorization = "Bearer " + required(c, "accessToken"); headers["Content-Type"] = "application/json"; body = "{}";
        break;
      case "aws_s3": {
        const region = required(c, "region");
        if (!/^[a-z]{2}-[a-z]+-\\d$/.test(region)) throw new Error("CREDENTIAL_FIELD_INVALID");
        const target = new URL("https://s3." + region + ".amazonaws.com/");
        target.searchParams.set("max-keys", "1");
        url = target.toString();
        Object.assign(headers, signedS3Headers(target, required(c, "accessKeyId"), required(c, "secretAccessKey"), region));
        break;
      }
      case "cloudflare_r2": {
        const account = required(c, "accountId");
        if (!/^[a-f0-9]{32}$/i.test(account)) throw new Error("CREDENTIAL_FIELD_INVALID");
        const target = new URL("https://" + account + ".r2.cloudflarestorage.com/");
        url = target.toString();
        Object.assign(headers, signedS3Headers(target, required(c, "accessKeyId"), required(c, "secretAccessKey"), "auto"));
        break;
      }
      case "mistral":
        url = "https://api.mistral.ai/v1/models"; headers.Authorization = "Bearer " + required(c, "apiKey"); break;
      case "groq":
        url = "https://api.groq.com/openai/v1/models"; headers.Authorization = "Bearer " + required(c, "apiKey"); break;
      case "perplexity":
        return { ok: false, message: "Perplexity does not expose a safe read-only credential check. No paid generation request was sent; this connection remains unverified and live execution stays blocked.", status: 409 };
      case "discord":
        url = "https://discord.com/api/v10/users/@me"; headers.Authorization = "Bot " + required(c, "botToken"); break;
      case "telegram":
        url = "https://api.telegram.org/bot" + encodeURIComponent(required(c, "botToken")) + "/getMe"; break;
      case "whatsapp_business":
        url = "https://graph.facebook.com/v22.0/" + encodeURIComponent(required(c, "phoneNumberId")) + "?fields=display_phone_number,verified_name";
        headers.Authorization = "Bearer " + required(c, "accessToken"); break;
      case "sendgrid":
        url = "https://api.sendgrid.com/v3/user/profile"; headers.Authorization = "Bearer " + required(c, "apiKey"); break;
      case "mailgun":
        url = "https://api.mailgun.net/v3/domains/" + encodeURIComponent(required(c, "domain"));
        headers.Authorization = "Basic " + Buffer.from("api:" + required(c, "apiKey")).toString("base64"); break;
      case "postmark":
        url = "https://api.postmarkapp.com/server"; headers["X-Postmark-Server-Token"] = required(c, "serverToken"); break;
      case "github":
        url = "https://api.github.com/user"; headers.Authorization = "Bearer " + required(c, "token"); headers.Accept = "application/vnd.github+json"; break;
      case "gitlab":
        url = "https://gitlab.com/api/v4/user"; headers["PRIVATE-TOKEN"] = required(c, "token"); break;
      case "sentry":
        url = "https://sentry.io/api/0/"; headers.Authorization = "Bearer " + required(c, "authToken"); break;
      case "vercel":
        url = "https://api.vercel.com/v2/user"; headers.Authorization = "Bearer " + required(c, "token"); break;
      case "calendly":
        url = "https://api.calendly.com/users/me"; headers.Authorization = "Bearer " + required(c, "accessToken"); break;
      case "zendesk": {
        const subdomain = required(c, "subdomain");
        if (!/^[a-z0-9][a-z0-9-]*$/i.test(subdomain)) throw new Error("CREDENTIAL_FIELD_INVALID");
        url = "https://" + subdomain + ".zendesk.com/api/v2/users/me.json";
        headers.Authorization = "Basic " + Buffer.from(required(c, "email") + "/token:" + required(c, "apiToken")).toString("base64"); break;
      }
      case "freshdesk": {
        const domain = required(c, "domain");
        if (!/^[a-z0-9][a-z0-9-]*$/i.test(domain)) throw new Error("CREDENTIAL_FIELD_INVALID");
        url = "https://" + domain + ".freshdesk.com/api/v2/agents/me";
        headers.Authorization = "Basic " + Buffer.from(required(c, "apiKey") + ":X").toString("base64"); break;
      }
      case "serpapi":
        url = "https://serpapi.com/account.json?api_key=" + encodeURIComponent(required(c, "apiKey")); break;
      case "openweather":
        url = "https://api.openweathermap.org/data/2.5/weather?q=London&appid=" + encodeURIComponent(required(c, "apiKey")); break;

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
    // A re-test must not leave a previously passed credential marked ready
    // while the new verification attempt is still in flight or has failed.
    const { error: invalidateError } = await db.from("workspace_integrations").update({
      status: "needs_attention", last_tested_at: null, last_test_status: null,
    }).eq("id", integration.id).eq("workspace_id", workspace.id);
    if (invalidateError) throw invalidateError;
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
