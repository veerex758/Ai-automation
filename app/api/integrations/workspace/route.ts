import { NextResponse, type NextRequest } from "next/server";
import { getAdminSupabaseConfig } from "@/lib/supabase/admin";
import { randomUUID } from "node:crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
import { hasWorkspacePermission } from "@/lib/supabase/permissions";
import { encryptWorkspaceCredentialsV2, type WorkspaceCredentialProvider } from "@/lib/integrations/workspace-credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const providers = new Set<WorkspaceCredentialProvider>(["openai", "gemini", "resend", "slack", "http", "notion", "hubspot", "twilio", "shopify", "stripe", "linear", "claude", "mistral", "groq", "perplexity", "discord", "telegram", "whatsapp_business", "sendgrid", "mailgun", "postmark", "github", "gitlab", "sentry", "vercel", "calendly", "zendesk", "freshdesk", "serpapi", "openweather", "elevenlabs", "stability_ai", "hugging_face", "pinecone", "microsoft_teams", "salesforce", "pipedrive", "zoho_crm", "freshsales", "close", "apollo", "intercom", "jira", "asana", "trello", "clickup", "monday", "todoist", "airtable", "bitbucket", "netlify", "woocommerce", "paypal", "paddle", "lemon_squeezy", "square", "razorpay", "zoom", "cal_com", "twilio_voice", "docusign", "x_twitter", "linkedin", "facebook_pages", "instagram", "tiktok", "mailchimp", "typeform", "supabase", "postgresql", "mysql", "mongodb", "redis", "firebase", "dropbox", "aws_s3", "cloudflare_r2"]);
const labels: Record<WorkspaceCredentialProvider, string> = {
  openai: "OpenAI", gemini: "Gemini", resend: "Resend", slack: "Slack", http: "HTTP API",
  notion: "Notion", hubspot: "HubSpot", twilio: "Twilio", shopify: "Shopify", stripe: "Stripe", linear: "Linear",
claude: "Claude",
  mistral: "Mistral",
  groq: "Groq",
  perplexity: "Perplexity",
  discord: "Discord",
  telegram: "Telegram",
  whatsapp_business: "WhatsApp Business",
  sendgrid: "SendGrid",
  mailgun: "Mailgun",
  postmark: "Postmark",
  github: "GitHub",
  gitlab: "GitLab",
  sentry: "Sentry",
  vercel: "Vercel",
  calendly: "Calendly",
  zendesk: "Zendesk",
  freshdesk: "Freshdesk",
  serpapi: "SerpAPI",
  openweather: "OpenWeather",
  elevenlabs: "ElevenLabs", stability_ai: "Stability AI", hugging_face: "Hugging Face", pinecone: "Pinecone",
  microsoft_teams: "Microsoft Teams", salesforce: "Salesforce", pipedrive: "Pipedrive", zoho_crm: "Zoho CRM",
  freshsales: "Freshsales", close: "Close", apollo: "Apollo", intercom: "Intercom",
  jira: "Jira", asana: "Asana", trello: "Trello", clickup: "ClickUp", monday: "Monday.com",
  todoist: "Todoist", airtable: "Airtable", bitbucket: "Bitbucket", netlify: "Netlify",
  woocommerce: "WooCommerce", paypal: "PayPal", paddle: "Paddle", lemon_squeezy: "Lemon Squeezy", square: "Square", razorpay: "Razorpay",
  zoom: "Zoom", cal_com: "Cal.com", twilio_voice: "Twilio Voice", docusign: "DocuSign",
  x_twitter: "X/Twitter", linkedin: "LinkedIn", facebook_pages: "Facebook Pages", instagram: "Instagram", tiktok: "TikTok", mailchimp: "Mailchimp", typeform: "Typeform",
  supabase: "Supabase", postgresql: "PostgreSQL", mysql: "MySQL", mongodb: "MongoDB", redis: "Redis", firebase: "Firebase", dropbox: "Dropbox", aws_s3: "AWS S3", cloudflare_r2: "Cloudflare R2",
};
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

function serviceClient() {
  const { url, serviceRoleKey: key } = getAdminSupabaseConfig();
  if (!url || !key) throw new Error("INTEGRATION_DATABASE_NOT_CONFIGURED");
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

const integrationErrorMessages: Record<string, string> = {
  INTEGRATION_DATABASE_NOT_CONFIGURED: "Integration database access is not configured on this server.",
  WORKSPACE_CREDENTIAL_ENCRYPTION_NOT_CONFIGURED: "Workspace credential encryption is not configured on this server.",
  WORKSPACE_CREDENTIAL_ENCRYPTION_KEY_INVALID: "Workspace credential encryption configuration is invalid.",
  WORKSPACE_CREDENTIALS_INVALID: "Credential fields are invalid for this provider.",
  INTEGRATION_REQUEST_INVALID: "The integration request is invalid.",
  INTEGRATION_PROVIDER_UNSUPPORTED: "This integration provider is not supported.",
  INTEGRATION_DISPLAY_NAME_INVALID: "The connection name must contain between 1 and 120 characters.",
  INTEGRATION_CREDENTIALS_INVALID: "The encrypted credential payload is invalid.",
  INTEGRATION_WORKSPACE_NOT_FOUND: "The workspace could not be found.",
  INTEGRATION_PERMISSION_DENIED: "Only workspace owners and admins can manage integrations.",
  INTEGRATION_CONNECTION_NOT_FOUND: "The requested connection was not found in this workspace.",
  INTEGRATION_MEMBERSHIP_CHECK_FAILED: "Workspace permissions could not be verified.",
  INTEGRATION_DATABASE_SCHEMA_MISMATCH: "Integration storage is not ready. Apply the latest database migration.",
  INTEGRATION_DATABASE_PERMISSION_DENIED: "The server cannot access integration storage. Verify database grants.",
  INTEGRATION_DATABASE_CONFLICT: "This integration changed concurrently. Refresh and try again.",
  INTEGRATION_DATABASE_REFERENCE_INVALID: "The workspace or integration reference is invalid.",
  INTEGRATION_DATABASE_TIMEOUT: "The integration database operation timed out. Try again.",
  INTEGRATION_LOAD_FAILED: "Could not load workspace integrations.",
  INTEGRATION_SAVE_FAILED: "Could not securely save this workspace integration.",
  INTEGRATION_DISCONNECT_FAILED: "Could not disconnect this workspace connection.",
};

const integrationErrorStatuses: Record<string, number> = {
  INTEGRATION_DATABASE_NOT_CONFIGURED: 503,
  WORKSPACE_CREDENTIAL_ENCRYPTION_NOT_CONFIGURED: 503,
  WORKSPACE_CREDENTIAL_ENCRYPTION_KEY_INVALID: 503,
  WORKSPACE_CREDENTIALS_INVALID: 400,
  INTEGRATION_REQUEST_INVALID: 400,
  INTEGRATION_PROVIDER_UNSUPPORTED: 400,
  INTEGRATION_DISPLAY_NAME_INVALID: 400,
  INTEGRATION_CREDENTIALS_INVALID: 400,
  INTEGRATION_WORKSPACE_NOT_FOUND: 404,
  INTEGRATION_PERMISSION_DENIED: 403,
  INTEGRATION_CONNECTION_NOT_FOUND: 404,
  INTEGRATION_MEMBERSHIP_CHECK_FAILED: 503,
  INTEGRATION_DATABASE_SCHEMA_MISMATCH: 503,
  INTEGRATION_DATABASE_PERMISSION_DENIED: 503,
  INTEGRATION_DATABASE_CONFLICT: 409,
  INTEGRATION_DATABASE_REFERENCE_INVALID: 400,
  INTEGRATION_DATABASE_TIMEOUT: 503,
  INTEGRATION_LOAD_FAILED: 500,
  INTEGRATION_SAVE_FAILED: 500,
  INTEGRATION_DISCONNECT_FAILED: 500,
};

function integrationFailure(error: unknown, fallbackCode: string) {
  const message = error instanceof Error
    ? error.message
    : isRecord(error) && typeof error.message === "string" ? error.message : "";
  const databaseCode = isRecord(error) && typeof error.code === "string" ? error.code : "";
  let code = Object.hasOwn(integrationErrorMessages, message) ? message : fallbackCode;

  if (!Object.hasOwn(integrationErrorMessages, message)) {
    if (["42P01", "42703", "42883", "PGRST202"].includes(databaseCode)) {
      code = "INTEGRATION_DATABASE_SCHEMA_MISMATCH";
    } else if (databaseCode === "42501") {
      code = "INTEGRATION_DATABASE_PERMISSION_DENIED";
    } else if (databaseCode === "23505") {
      code = "INTEGRATION_DATABASE_CONFLICT";
    } else if (databaseCode === "23503") {
      code = "INTEGRATION_DATABASE_REFERENCE_INVALID";
    } else if (databaseCode === "57014") {
      code = "INTEGRATION_DATABASE_TIMEOUT";
    } else if (databaseCode === "22023" || databaseCode === "22P02") {
      code = "INTEGRATION_REQUEST_INVALID";
    }
  }

  return json({
    error: integrationErrorMessages[code] ?? integrationErrorMessages[fallbackCode],
    code,
  }, integrationErrorStatuses[code] ?? 500);
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json({ error: "Authentication required.", code: "AUTHENTICATION_REQUIRED" }, 401);
    const workspace = await getOrCreateDefaultWorkspace(supabase);
    if (!(await hasWorkspacePermission(supabase, workspace.id, user.id, "integrations.view"))) {
      return json({ error: "Workspace integrations.view permission required.", code: "INTEGRATION_PERMISSION_DENIED" }, 403);
    }
    const { data, error } = await supabase.from("workspace_integrations")
      .select("id,provider,status,display_name,last_tested_at,last_test_status,updated_at,metadata")
      .eq("workspace_id", workspace.id).order("provider", { ascending: true });
    if (error) throw error;
    const recipient = request.nextUrl.searchParams.get("recipient")?.trim().toLowerCase() ?? "";
    const allowedRecipients = new Set((process.env.AIVANTA_LIVE_EMAIL_RECIPIENTS ?? "")
      .split(",").map((item) => item.trim().toLowerCase()).filter(Boolean));
    return json({
      integrations: (data ?? []).map((item) => ({
        ...item,
        label: providers.has(item.provider as WorkspaceCredentialProvider)
          ? labels[item.provider as WorkspaceCredentialProvider] : "Integration",
      })),
      liveExecutionEnabled: process.env.AIVANTA_LIVE_EXECUTION_ENABLED === "true",
      liveProvidersEnabled: (process.env.AIVANTA_LIVE_INTEGRATIONS ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean),
      emailRecipientAllowed: Boolean(recipient) && allowedRecipients.has(recipient),
    });
  } catch (error) {
    return integrationFailure(error, "INTEGRATION_LOAD_FAILED");
  }
}

export async function POST(request: NextRequest) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (contentLength > 12 * 1024) return json({ error: "Credential request exceeds the 12 KB limit.", code: "INTEGRATION_REQUEST_TOO_LARGE" }, 413);

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json({ error: "Authentication required." }, 401);

    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > 12 * 1024) return json({ error: "Credential request exceeds the 12 KB limit.", code: "INTEGRATION_REQUEST_TOO_LARGE" }, 413);
    let body: unknown;
    try { body = JSON.parse(rawBody); } catch { return json({ error: "Request body must be valid JSON.", code: "INTEGRATION_REQUEST_INVALID" }, 400); }
    if (!isRecord(body) || typeof body.provider !== "string" || !providers.has(body.provider as WorkspaceCredentialProvider) ||
        !isRecord(body.credentials)) {
      return json({ error: "Provide a supported provider and its credential fields.", code: "INTEGRATION_REQUEST_INVALID" }, 400);
    }

    const provider = body.provider as WorkspaceCredentialProvider;
    const displayName = typeof body.displayName === "string" && body.displayName.trim()
      ? body.displayName.trim().slice(0, 120) : labels[provider];
    if (body.connectionId !== undefined && typeof body.connectionId !== "string") return json({ error: "The connection ID is invalid.", code: "INTEGRATION_REQUEST_INVALID" }, 400);
    const requestedConnectionId = typeof body.connectionId === "string" ? body.connectionId : undefined;
    if (requestedConnectionId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedConnectionId)) {
      return json({ error: "The connection ID is invalid.", code: "INTEGRATION_REQUEST_INVALID" }, 400);
    }
    const workspace = await getOrCreateDefaultWorkspace(supabase);
    const { data: membership, error: membershipError } = await supabase.from("workspace_members")
      .select("role").eq("workspace_id", workspace.id).eq("user_id", user.id).maybeSingle();
    if (membershipError) throw new Error("INTEGRATION_MEMBERSHIP_CHECK_FAILED");
    if (!membership || !["owner", "admin"].includes(membership.role)) {
      return json({ error: integrationErrorMessages.INTEGRATION_PERMISSION_DENIED, code: "INTEGRATION_PERMISSION_DENIED" }, 403);
    }

    const connectionId = requestedConnectionId ?? randomUUID();
    let encrypted: string;
    try {
      encrypted = encryptWorkspaceCredentialsV2({ [provider]: body.credentials as Record<string, string> }, `${workspace.id}:${provider}:${connectionId}`);
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      const safeCode = ["WORKSPACE_CREDENTIAL_ENCRYPTION_NOT_CONFIGURED", "WORKSPACE_CREDENTIAL_ENCRYPTION_KEY_INVALID", "WORKSPACE_CREDENTIALS_INVALID"].includes(code)
        ? code : "WORKSPACE_CREDENTIALS_INVALID";
      const status = integrationErrorStatuses[safeCode];
      return json({ error: integrationErrorMessages[safeCode], code: safeCode }, status);
    }

    const db = serviceClient();
    // The connection RPC writes metadata and the encrypted secret atomically.
    // Existing connections are updated by (id, workspace, provider), while a
    // missing ID always creates another account instead of overwriting one.
    const { data, error } = await db.rpc("save_workspace_integration_connection", {
      p_workspace_id: workspace.id,
      p_provider: provider,
      p_display_name: displayName,
      p_encrypted_credentials: encrypted,
      p_created_by: user.id,
      p_connection_id: connectionId,
      p_create_new: requestedConnectionId === undefined,
    });
    if (error || !isRecord(data) || typeof data.id !== "string") throw error ?? new Error("INTEGRATION_SAVE_FAILED");
    return json({ integration: data }, 201);
  } catch (error) {
    return integrationFailure(error, "INTEGRATION_SAVE_FAILED");
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json({ error: "Authentication required." }, 401);
    const body = await request.json().catch(() => null);
    const connectionId = isRecord(body) && typeof body.connectionId === "string" ? body.connectionId : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(connectionId)) {
      return json({ error: "A valid connection ID is required.", code: "INTEGRATION_REQUEST_INVALID" }, 400);
    }
    const workspace = await getOrCreateDefaultWorkspace(supabase);
    const { data: membership, error: membershipError } = await supabase.from("workspace_members")
      .select("role").eq("workspace_id", workspace.id).eq("user_id", user.id).maybeSingle();
    if (membershipError) throw new Error("INTEGRATION_MEMBERSHIP_CHECK_FAILED");
    if (!membership || !["owner", "admin"].includes(membership.role)) {
      return json({ error: integrationErrorMessages.INTEGRATION_PERMISSION_DENIED, code: "INTEGRATION_PERMISSION_DENIED" }, 403);
    }
    const db = serviceClient();
    const { data: connection, error: lookupError } = await db.from("workspace_integrations")
      .select("id").eq("id", connectionId).eq("workspace_id", workspace.id).maybeSingle();
    if (lookupError) throw lookupError;
    if (!connection) return json({ error: integrationErrorMessages.INTEGRATION_CONNECTION_NOT_FOUND, code: "INTEGRATION_CONNECTION_NOT_FOUND" }, 404);
    const { error: deleteError } = await db.from("workspace_integrations")
      .delete().eq("id", connectionId).eq("workspace_id", workspace.id);
    if (deleteError) throw deleteError;
    return json({ success: true, disconnected: true });
  } catch (error) {
    return integrationFailure(error, "INTEGRATION_DISCONNECT_FAILED");
  }
}
