import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
import { encryptWorkspaceCredentials, type WorkspaceCredentialProvider } from "@/lib/integrations/workspace-credentials";

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
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.CODED_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.CODED_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("INTEGRATION_DATABASE_NOT_CONFIGURED");
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json({ error: "Authentication required." }, 401);
    const workspace = await getOrCreateDefaultWorkspace(supabase);
    const { data, error } = await supabase.from("workspace_integrations")
      .select("id,provider,status,display_name,last_tested_at,last_test_status,updated_at")
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
  } catch {
    return json({ error: "Could not load workspace integrations." }, 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (contentLength > 12 * 1024) return json({ error: "Credential request exceeds the 12 KB limit." }, 413);

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json({ error: "Authentication required." }, 401);

    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > 12 * 1024) return json({ error: "Credential request exceeds the 12 KB limit." }, 413);
    let body: unknown;
    try { body = JSON.parse(rawBody); } catch { return json({ error: "Request body must be valid JSON." }, 400); }
    if (!isRecord(body) || typeof body.provider !== "string" || !providers.has(body.provider as WorkspaceCredentialProvider) ||
        !isRecord(body.credentials)) {
      return json({ error: "Provide a supported provider and its credential fields." }, 400);
    }

    const provider = body.provider as WorkspaceCredentialProvider;
    const displayName = typeof body.displayName === "string" && body.displayName.trim()
      ? body.displayName.trim().slice(0, 120) : labels[provider];
    const workspace = await getOrCreateDefaultWorkspace(supabase);
    const { data: membership, error: membershipError } = await supabase.from("workspace_members")
      .select("role").eq("workspace_id", workspace.id).eq("user_id", user.id).maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership || !["owner", "admin"].includes(membership.role)) {
      return json({ error: "Only workspace owners and admins can manage integrations." }, 403);
    }

    let encrypted: string;
    try {
      encrypted = encryptWorkspaceCredentials({ [provider]: body.credentials as Record<string, string> }, undefined, `${workspace.id}:${provider}`);
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      const status = code === "WORKSPACE_CREDENTIAL_ENCRYPTION_NOT_CONFIGURED" ||
        code === "WORKSPACE_CREDENTIAL_ENCRYPTION_KEY_INVALID" ? 503 : 400;
      return json({ error: status === 503
        ? "Workspace credential encryption is not configured on this server."
        : "Credential fields are invalid for this provider." }, status);
    }

    const db = serviceClient();
    // Revoke readiness before replacing a saved secret so no worker can race
    // the credential update using the previous successful verification.
    const { data: existing, error: existingError } = await db.from("workspace_integrations")
      .select("id").eq("workspace_id", workspace.id).eq("provider", provider).maybeSingle();
    if (existingError) throw existingError;
    if (existing) {
      const { error: invalidateError } = await db.from("workspace_integrations").update({
        status: "needs_attention", last_tested_at: null, last_test_status: null,
      }).eq("id", existing.id).eq("workspace_id", workspace.id);
      if (invalidateError) throw invalidateError;
    }
    const { data, error } = provider === "mysql" || provider === "mongodb"
      ? await db.rpc("save_workspace_database_credentials", {
          p_workspace_id: workspace.id,
          p_provider: provider,
          p_display_name: displayName,
          p_encrypted_credential: encrypted,
          p_created_by: user.id,
        })
      : await db.rpc("save_workspace_integration_credentials", {
          p_workspace_id: workspace.id,
          p_provider: provider,
          p_display_name: displayName,
          p_encrypted_credentials: encrypted,
          p_created_by: user.id,
        });
    const integrationId = typeof data === "string" ? data : isRecord(data) && typeof data.id === "string" ? data.id : null;
    if (error || !integrationId) throw error ?? new Error("INTEGRATION_SAVE_FAILED");
    // Replacing a secret invalidates any previous successful test. A new
    // credential must pass a fresh provider check before the worker will use it.
    const { error: invalidateError } = await db.from("workspace_integrations").update({
      status: "needs_attention",
      last_tested_at: null,
      last_test_status: null,
    }).eq("id", integrationId).eq("workspace_id", workspace.id);
    if (invalidateError) throw invalidateError;
    return json({ integration: {
      id: integrationId, provider, display_name: displayName,
      status: "needs_attention", last_tested_at: null, last_test_status: null,
    } }, 201);
  } catch {
    return json({ error: "Could not securely save this workspace integration." }, 500);
  }
}
