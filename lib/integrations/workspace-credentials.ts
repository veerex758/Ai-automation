import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type WorkspaceCredentialProvider =
  | "openai" | "gemini" | "resend" | "slack" | "http"
  | "notion" | "hubspot" | "twilio" | "shopify" | "stripe" | "linear" | "claude" | "mistral" | "groq" | "perplexity" | "discord" | "telegram" | "whatsapp_business" | "sendgrid" | "mailgun" | "postmark" | "github" | "gitlab" | "sentry" | "vercel" | "calendly" | "zendesk" | "freshdesk" | "serpapi" | "openweather" | "elevenlabs" | "stability_ai" | "hugging_face" | "pinecone" | "microsoft_teams" | "salesforce" | "pipedrive" | "zoho_crm" | "freshsales" | "close" | "apollo" | "intercom" | "jira" | "asana" | "trello" | "clickup" | "monday" | "todoist" | "airtable" | "bitbucket" | "netlify" | "woocommerce" | "paypal" | "paddle" | "lemon_squeezy" | "square" | "razorpay" | "zoom" | "cal_com" | "twilio_voice" | "docusign" | "x_twitter" | "linkedin" | "facebook_pages" | "instagram" | "tiktok" | "mailchimp" | "typeform" | "supabase" | "postgresql" | "mysql" | "mongodb" | "redis" | "firebase" | "dropbox" | "aws_s3" | "cloudflare_r2";
export type WorkspaceCredentials = Record<string, Record<string, string>>;

const KEY_BYTES = 32;
const MAX_CREDENTIAL_BYTES = 32 * 1024;
const PROVIDER_FIELDS: Record<WorkspaceCredentialProvider, readonly string[]> = {
  openai: ["apiKey"],
  gemini: ["apiKey"],
  resend: ["apiKey", "fromEmail"],
  slack: ["webhookUrl", "botToken"],
  http: ["apiKey", "username", "password", "baseUrl"],
 ¶»§q«^