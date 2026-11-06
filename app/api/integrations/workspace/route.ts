import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
import { encryptWorkspaceCredentials, type WorkspaceCredentialProvider } from "@/lib/integrations/workspace-credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const providers = new Set<WorkspaceCredentialProvider>(["openai", "gemini", "resend", "slack", "http", "notion", "hubspot", "twilio", "shopify", "stripe", "linear", "claude", "mistral", "groq", "perplexity", "discord", "telegram", "whatsapp_business", "sendgrid", "mailgun", "postmark", "github", "gitlab", "sentry", "vercel", "calendly", "zendesk", "freshdesk", "serpapi", "openweather", "elevenlabs", "stability_ai", "hugging_face", "pinecone", "microsoft_teams", "salesforce", "pipedrive", "zoho_crm", "freshsales", "close", "apollo", "intercom", "jira", "asana", "trello", "clickup", "monday", "todoist", "airtable", "bitbucket", "netlify", "woocommerce", "paypal", "paddle", "lemon_squeezy", "square", "razorpay", "zoom", "cal_com", "twilio_voice", "docusign", "x_twitter", "linkedin", "facebook_pages", "instagram", "tiktok", "mailchimp", "typeform", "supabase", "postgresql", "mysql", "mongodb", "redis", "firebase", "dropbox", "aws_s3", "cloudflare_r2"]);
const labels: Record<WorkspaceCredentialProvider, string> = {
  openai: "¶»§q«^