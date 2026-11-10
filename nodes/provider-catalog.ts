import type { AuthConfig } from "./types";

export type ProviderCatalogEntry = {
  id: string;
  name: string;
  category: string;
  group: string;
  auth: AuthConfig["type"];
  registryId?: string;
};

/** Complete user-facing inventory. Catalogue-only entries are never executable. */
export const providerCatalog: ProviderCatalogEntry[] = [
  {
    "id": "webhook_trigger",
    "name": "Webhook Trigger",
    "category": "core",
    "group": "Core and logic",
    "auth": "none",
    "registryId": "webhooks"
  },
  {
    "id": "schedule_cron",
    "name": "Schedule/Cron",
    "category": "core",
    "group": "Core and logic",
    "auth": "none",
    "registryId": "schedule"
  },
  {
    "id": "manual_trigger",
    "name": "Manual Trigger",
    "category": "core",
    "group": "Core and logic",
    "auth": "none",
    "registryId": "manual"
  },
  {
    "id": "http_request",
    "name": "HTTP Request",
    "category": "core",
    "group": "Core and logic",
    "auth": "apiKey",
    "registryId": "http_request"
  },
  {
    "id": "if",
    "name": "IF",
    "category": "core",
    "group": "Core and logic",
    "auth": "none",
    "registryId": "if"
  },
  {
    "id": "switch",
    "name": "Switch",
    "category": "core",
    "group": "Core and logic",
    "auth": "none",
    "registryId": "switch"
  },
  {
    "id": "loop",
    "name": "Loop",
    "category": "core",
    "group": "Core and logic",
    "auth": "none",
    "registryId": "loop"
  },
  {
    "id": "merge",
    "name": "Merge",
    "category": "core",
    "group": "Core and logic",
    "auth": "none",
    "registryId": "merge"
  },
  {
    "id": "wait_delay",
    "name": "Wait/Delay",
    "category": "core",
    "group": "Core and logic",
    "auth": "none",
    "registryId": "wait"
  },
  {
    "id": "code_js",
    "name": "Code (JS)",
    "category": "core",
    "group": "Core and logic",
    "auth": "none",
    "registryId": "javascript"
  },
  {
    "id": "set_fields",
    "name": "Set Fields",
    "registryId": "set_fields",
    "category": "data",
    "group": "Data utilities",
    "auth": "none"
  },
  {
    "id": "json_parse",
    "name": "JSON Parse",
    "registryId": "json_parse",
    "category": "data",
    "group": "Data utilities",
    "auth": "none"
  },
  {
    "id": "filter",
    "name": "Filter",
    "registryId": "filter",
    "category": "data",
    "group": "Data utilities",
    "auth": "none"
  },
  {
    "id": "aggregate",
    "name": "Aggregate",
    "registryId": "aggregate",
    "category": "data",
    "group": "Data utilities",
    "auth": "none"
  },
  {
    "id": "date_time",
    "name": "Date/Time",
    "registryId": "date_time",
    "category": "data",
    "group": "Data utilities",
    "auth": "none"
  },
  {
    "id": "gemini",
    "name": "Gemini",
    "category": "ai",
    "group": "AI",
    "auth": "apiKey",
    "registryId": "gemini"
  },
  {
    "id": "openai",
    "name": "OpenAI",
    "category": "ai",
    "group": "AI",
    "auth": "apiKey",
    "registryId": "openai"
  },
  {
    "id": "claude",
    "name": "Claude",
    "category": "ai",
    "group": "AI",
    "auth": "apiKey",
    "registryId": "claude"
  },
  {
    "id": "mistral",
    "name": "Mistral",
    "category": "ai",
    "group": "AI",
    "auth": "apiKey",
    "registryId": "mistral"
  },
  {
    "id": "groq",
    "name": "Groq",
    "category": "ai",
    "group": "AI",
    "auth": "apiKey",
    "registryId": "groq"
  },
  {
    "id": "perplexity",
    "name": "Perplexity",
    "category": "ai",
    "group": "AI",
    "auth": "apiKey",
    "registryId": "perplexity"
  },
  {
    "id": "elevenlabs",
    "name": "ElevenLabs",
    "category": "ai",
    "group": "AI",
    "auth": "apiKey",
    "registryId": "elevenlabs"
  },
  {
    "id": "stability_ai",
    "name": "Stability AI",
    "category": "ai",
    "group": "AI",
    "auth": "apiKey",
    "registryId": "stability_ai"
  },
  {
    "id": "hugging_face",
    "name": "Hugging Face",
    "category": "ai",
    "group": "AI",
    "auth": "apiKey",
    "registryId": "hugging_face"
  },
  {
    "id": "pinecone",
    "name": "Pinecone",
    "category": "ai",
    "group": "AI",
    "auth": "apiKey",
    "registryId": "pinecone"
  },
  {
    "id": "gmail",
    "name": "Gmail",
    "category": "google",
    "group": "Google",
    "auth": "oauth2",
    "registryId": "gmail"
  },
  {
    "id": "google_sheets",
    "name": "Sheets",
    "category": "google",
    "group": "Google",
    "auth": "oauth2",
    "registryId": "google_sheets"
  },
  {
    "id": "google_drive",
    "name": "Drive",
    "category": "google",
    "group": "Google",
    "auth": "oauth2",
    "registryId": "google_drive"
  },
  {
    "id": "google_calendar",
    "name": "Calendar",
    "category": "google",
    "group": "Google",
    "auth": "oauth2",
    "registryId": "google_calendar"
  },
  {
    "id": "google_docs",
    "name": "Docs",
    "category": "google",
    "group": "Google",
    "auth": "oauth2",
    "registryId": "google_docs"
  },
  {
    "id": "google_forms",
    "name": "Forms",
    "category": "google",
    "group": "Google",
    "auth": "oauth2",
    "registryId": "google_forms"
  },
  {
    "id": "youtube",
    "name": "YouTube",
    "category": "google",
    "group": "Google",
    "auth": "oauth2",
    "registryId": "youtube"
  },
  {
    "id": "google_contacts",
    "name": "Contacts",
    "category": "google",
    "group": "Google",
    "auth": "oauth2",
    "registryId": "google_contacts"
  },
  {
    "id": "slack",
    "name": "Slack",
    "category": "communication",
    "group": "Messaging and email",
    "auth": "apiKey",
    "registryId": "slack"
  },
  {
    "id": "discord",
    "name": "Discord",
    "category": "communication",
    "group": "Messaging and email",
    "auth": "apiKey",
    "registryId": "discord"
  },
  {
    "id": "telegram",
    "name": "Telegram",
    "category": "communication",
    "group": "Messaging and email",
    "auth": "apiKey",
    "registryId": "telegram"
  },
  {
    "id": "whatsapp_business",
    "name": "WhatsApp Business",
    "category": "communication",
    "group": "Messaging and email",
    "auth": "apiKey",
    "registryId": "whatsapp_business"
  },
  {
    "id": "twilio_sms",
    "name": "Twilio SMS",
    "category": "communication",
    "group": "Messaging and email",
    "auth": "apiKey",
    "registryId": "twilio"
  },
  {
    "id": "microsoft_teams",
    "name": "Microsoft Teams",
    "category": "communication",
    "group": "Messaging and email",
    "auth": "oauth2",
    "registryId": "microsoft_teams"
  },
  {
    "id": "resend",
    "name": "Resend",
    "category": "communication",
    "group": "Messaging and email",
    "auth": "apiKey",
    "registryId": "email"
  },
  {
    "id": "sendgrid",
    "name": "SendGrid",
    "category": "communication",
    "group": "Messaging and email",
    "auth": "apiKey",
    "registryId": "sendgrid"
  },
  {
    "id": "mailgun",
    "name": "Mailgun",
    "category": "communication",
    "group": "Messaging and email",
    "auth": "apiKey",
    "registryId": "mailgun"
  },
  {
    "id": "postmark",
    "name": "Postmark",
    "category": "communication",
    "group": "Messaging and email",
    "auth": "apiKey",
    "registryId": "postmark"
  },
  {
    "id": "hubspot",
    "name": "HubSpot",
    "category": "crm",
    "group": "CRM and sales",
    "auth": "oauth2",
    "registryId": "hubspot"
  },
  {
    "id": "salesforce",
    "name": "Salesforce",
    "category": "crm",
    "group": "CRM and sales",
    "auth": "oauth2",
    "registryId": "salesforce"
  },
  {
    "id": "pipedrive",
    "name": "Pipedrive",
    "category": "crm",
    "group": "CRM and sales",
    "auth": "oauth2",
    "registryId": "pipedrive"
  },
  {
    "id": "zoho_crm",
    "name": "Zoho CRM",
    "category": "crm",
    "group": "CRM and sales",
    "auth": "oauth2",
    "registryId": "zoho_crm"
  },
  {
    "id": "freshsales",
    "name": "Freshsales",
    "category": "crm",
    "group": "CRM and sales",
    "auth": "oauth2",
    "registryId": "freshsales"
  },
  {
    "id": "close",
    "name": "Close",
    "category": "crm",
    "group": "CRM and sales",
    "auth": "apiKey",
    "registryId": "close"
  },
  {
    "id": "apollo",
    "name": "Apollo",
    "category": "crm",
    "group": "CRM and sales",
    "auth": "apiKey",
    "registryId": "apollo"
  },
  {
    "id": "intercom",
    "name": "Intercom",
    "category": "crm",
    "group": "CRM and sales",
    "auth": "oauth2",
    "registryId": "intercom"
  },
  {
    "id": "notion",
    "name": "Notion",
    "category": "productivity",
    "group": "Productivity and PM",
    "auth": "oauth2",
    "registryId": "notion"
  },
  {
    "id": "linear",
    "name": "Linear",
    "category": "productivity",
    "group": "Productivity and PM",
    "auth": "oauth2",
    "registryId": "linear"
  },
  {
    "id": "jira",
    "name": "Jira",
    "category": "productivity",
    "group": "Productivity and PM",
    "auth": "apiKey",
    "registryId": "jira"
  },
  {
    "id": "asana",
    "name": "Asana",
    "category": "productivity",
    "group": "Productivity and PM",
    "auth": "oauth2",
    "registryId": "asana"
  },
  {
    "id": "trello",
    "name": "Trello",
    "category": "productivity",
    "group": "Productivity and PM",
    "auth": "apiKey",
    "registryId": "trello"
  },
  {
    "id": "clickup",
    "name": "ClickUp",
    "category": "productivity",
    "group": "Productivity and PM",
    "auth": "apiKey",
    "registryId": "clickup"
  },
  {
    "id": "monday",
    "name": "Monday.com",
    "category": "productivity",
    "group": "Productivity and PM",
    "auth": "apiKey",
    "registryId": "monday"
  },
  {
    "id": "todoist",
    "name": "Todoist",
    "category": "productivity",
    "group": "Productivity and PM",
    "auth": "oauth2",
    "registryId": "todoist"
  },
  {
    "id": "airtable",
    "name": "Airtable",
    "category": "productivity",
    "group": "Productivity and PM",
    "auth": "apiKey",
    "registryId": "airtable"
  },
  {
    "id": "github",
    "name": "GitHub",
    "category": "developer",
    "group": "Developer tools",
    "auth": "apiKey",
    "registryId": "github"
  },
  {
    "id": "gitlab",
    "name": "GitLab",
    "category": "developer",
    "group": "Developer tools",
    "auth": "apiKey",
    "registryId": "gitlab"
  },
  {
    "id": "bitbucket",
    "name": "Bitbucket",
    "category": "developer",
    "group": "Developer tools",
    "auth": "oauth2",
    "registryId": "bitbucket"
  },
  {
    "id": "sentry",
    "name": "Sentry",
    "category": "developer",
    "group": "Developer tools",
    "auth": "apiKey",
    "registryId": "sentry"
  },
  {
    "id": "vercel",
    "name": "Vercel",
    "category": "developer",
    "group": "Developer tools",
    "auth": "apiKey",
    "registryId": "vercel"
  },
  {
    "id": "netlify",
    "name": "Netlify",
    "category": "developer",
    "group": "Developer tools",
    "auth": "apiKey",
    "registryId": "netlify"
  },
  {
    "id": "supabase",
    "name": "Supabase",
    "category": "database",
    "group": "Databases and storage",
    "auth": "apiKey",
    "registryId": "supabase"
  },
  {
    "id": "postgresql",
    "name": "PostgreSQL",
    "category": "database",
    "group": "Databases and storage",
    "auth": "connectionString",
    "registryId": "postgresql"
  },
  {
    "id": "mysql",
    "name": "MySQL",
    "category": "database",
    "group": "Databases and storage",
    "auth": "connectionString",
    "registryId": "mysql"
  },
  {
    "id": "mongodb",
    "name": "MongoDB",
    "category": "database",
    "group": "Databases and storage",
    "auth": "connectionString",
    "registryId": "mongodb"
  },
  {
    "id": "redis",
    "name": "Redis",
    "category": "database",
    "group": "Databases and storage",
    "auth": "apiKey",
    "registryId": "redis"
  },
  {
    "id": "firebase",
    "name": "Firebase",
    "category": "database",
    "group": "Databases and storage",
    "auth": "oauth2",
    "registryId": "firebase"
  },
  {
    "id": "dropbox",
    "name": "Dropbox",
    "category": "database",
    "group": "Databases and storage",
    "auth": "oauth2",
    "registryId": "dropbox"
  },
  {
    "id": "aws_s3",
    "name": "AWS S3",
    "category": "database",
    "group": "Databases and storage",
    "auth": "apiKey",
    "registryId": "aws_s3"
  },
  {
    "id": "cloudflare_r2",
    "name": "Cloudflare R2",
    "category": "database",
    "group": "Databases and storage",
    "auth": "apiKey",
    "registryId": "cloudflare_r2"
  },
  {
    "id": "stripe",
    "name": "Stripe",
    "category": "payments",
    "group": "Payments and e-commerce",
    "auth": "apiKey",
    "registryId": "stripe"
  },
  {
    "id": "shopify",
    "name": "Shopify",
    "category": "payments",
    "group": "Payments and e-commerce",
    "auth": "apiKey",
    "registryId": "shopify"
  },
  {
    "id": "woocommerce",
    "name": "WooCommerce",
    "category": "payments",
    "group": "Payments and e-commerce",
    "auth": "apiKey",
    "registryId": "woocommerce"
  },
  {
    "id": "paypal",
    "name": "PayPal",
    "category": "payments",
    "group": "Payments and e-commerce",
    "auth": "apiKey",
    "registryId": "paypal"
  },
  {
    "id": "paddle",
    "name": "Paddle",
    "category": "payments",
    "group": "Payments and e-commerce",
    "auth": "apiKey",
    "registryId": "paddle"
  },
  {
    "id": "lemon_squeezy",
    "name": "Lemon Squeezy",
    "category": "payments",
    "group": "Payments and e-commerce",
    "auth": "apiKey",
    "registryId": "lemon_squeezy"
  },
  {
    "id": "square",
    "name": "Square",
    "category": "payments",
    "group": "Payments and e-commerce",
    "auth": "apiKey",
    "registryId": "square"
  },
  {
    "id": "razorpay",
    "name": "Razorpay",
    "category": "payments",
    "group": "Payments and e-commerce",
    "auth": "apiKey",
    "registryId": "razorpay"
  },
  {
    "id": "x_twitter",
    "name": "X/Twitter",
    "category": "marketing",
    "group": "Social and marketing",
    "auth": "oauth2",
    "registryId": "x_twitter"
  },
  {
    "id": "linkedin",
    "name": "LinkedIn",
    "category": "marketing",
    "group": "Social and marketing",
    "auth": "oauth2",
    "registryId": "linkedin"
  },
  {
    "id": "facebook_pages",
    "name": "Facebook Pages",
    "category": "marketing",
    "group": "Social and marketing",
    "auth": "oauth2",
    "registryId": "facebook_pages"
  },
  {
    "id": "instagram",
    "name": "Instagram",
    "category": "marketing",
    "group": "Social and marketing",
    "auth": "oauth2",
    "registryId": "instagram"
  },
  {
    "id": "tiktok",
    "name": "TikTok",
    "category": "marketing",
    "group": "Social and marketing",
    "auth": "oauth2",
    "registryId": "tiktok"
  },
  {
    "id": "mailchimp",
    "name": "Mailchimp",
    "category": "marketing",
    "group": "Social and marketing",
    "auth": "oauth2",
    "registryId": "mailchimp"
  },
  {
    "id": "typeform",
    "name": "Typeform",
    "category": "marketing",
    "group": "Social and marketing",
    "auth": "oauth2",
    "registryId": "typeform"
  },
  {
    "id": "calendly",
    "name": "Calendly",
    "category": "marketing",
    "group": "Social and marketing",
    "auth": "oauth2",
    "registryId": "calendly"
  },
  {
    "id": "zendesk",
    "name": "Zendesk",
    "category": "support",
    "group": "Support and misc",
    "auth": "apiKey",
    "registryId": "zendesk"
  },
  {
    "id": "freshdesk",
    "name": "Freshdesk",
    "category": "support",
    "group": "Support and misc",
    "auth": "apiKey",
    "registryId": "freshdesk"
  },
  {
    "id": "zoom",
    "name": "Zoom",
    "category": "support",
    "group": "Support and misc",
    "auth": "apiKey",
    "registryId": "zoom"
  },
  {
    "id": "cal_com",
    "name": "Cal.com",
    "category": "support",
    "group": "Support and misc",
    "auth": "apiKey",
    "registryId": "cal_com"
  },
  {
    "id": "twilio_voice",
    "name": "Twilio Voice",
    "category": "support",
    "group": "Support and misc",
    "auth": "apiKey",
    "registryId": "twilio_voice"
  },
  {
    "id": "docusign",
    "name": "DocuSign",
    "category": "support",
    "group": "Support and misc",
    "auth": "apiKey",
    "registryId": "docusign"
  },
  {
    "id": "rss_feed",
    "name": "RSS Feed",
    "category": "support",
    "group": "Support and misc",
    "auth": "none",
    "registryId": "rss_feed"
  },
  {
    "id": "serpapi",
    "name": "SerpAPI",
    "category": "support",
    "group": "Support and misc",
    "auth": "apiKey",
    "registryId": "serpapi"
  },
  {
    "id": "openweather",
    "name": "OpenWeather",
    "category": "support",
    "group": "Support and misc",
    "auth": "apiKey",
    "registryId": "openweather"
  }
];
