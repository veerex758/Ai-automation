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
    "auth": "apiKey"
  },
  {
    "id": "mistral",
    "name": "Mistral",
    "category": "ai",
    "group": "AI",
    "auth": "apiKey"
  },
  {
    "id": "groq",
    "name": "Groq",
    "category": "ai",
    "group": "AI",
    "auth": "apiKey"
  },
  {
    "id": "perplexity",
    "name": "Perplexity",
    "category": "ai",
    "group": "AI",
    "auth": "apiKey"
  },
  {
    "id": "elevenlabs",
    "name": "ElevenLabs",
    "category": "ai",
    "group": "AI",
    "auth": "apiKey"
  },
  {
    "id": "stability_ai",
    "name": "Stability AI",
    "category": "ai",
    "group": "AI",
    "auth": "apiKey"
  },
  {
    "id": "hugging_face",
    "name": "Hugging Face",
    "category": "ai",
    "group": "AI",
    "auth": "apiKey"
  },
  {
    "id": "pinecone",
    "name": "Pinecone",
    "category": "ai",
    "group": "AI",
    "auth": "apiKey"
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
    "auth": "oauth2"
  },
  {
    "id": "google_calendar",
    "name": "Calendar",
    "category": "google",
    "group": "Google",
    "auth": "oauth2"
  },
  {
    "id": "google_docs",
    "name": "Docs",
    "category": "google",
    "group": "Google",
    "auth": "oauth2"
  },
  {
    "id": "google_forms",
    "name": "Forms",
    "category": "google",
    "group": "Google",
    "auth": "oauth2"
  },
  {
    "id": "youtube",
    "name": "YouTube",
    "category": "google",
    "group": "Google",
    "auth": "oauth2"
  },
  {
    "id": "google_contacts",
    "name": "Contacts",
    "category": "google",
    "group": "Google",
    "auth": "oauth2"
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
    "auth": "apiKey"
  },
  {
    "id": "telegram",
    "name": "Telegram",
    "category": "communication",
    "group": "Messaging and email",
    "auth": "apiKey"
  },
  {
    "id": "whatsapp_business",
    "name": "WhatsApp Business",
    "category": "communication",
    "group": "Messaging and email",
    "auth": "apiKey"
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
    "auth": "apiKey"
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
    "auth": "apiKey"
  },
  {
    "id": "mailgun",
    "name": "Mailgun",
    "category": "communication",
    "group": "Messaging and email",
    "auth": "apiKey"
  },
  {
    "id": "postmark",
    "name": "Postmark",
    "category": "communication",
    "group": "Messaging and email",
    "auth": "apiKey"
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
    "auth": "oauth2"
  },
  {
    "id": "pipedrive",
    "name": "Pipedrive",
    "category": "crm",
    "group": "CRM and sales",
    "auth": "oauth2"
  },
  {
    "id": "zoho_crm",
    "name": "Zoho CRM",
    "category": "crm",
    "group": "CRM and sales",
    "auth": "oauth2"
  },
  {
    "id": "freshsales",
    "name": "Freshsales",
    "category": "crm",
    "group": "CRM and sales",
    "auth": "oauth2"
  },
  {
    "id": "close",
    "name": "Close",
    "category": "crm",
    "group": "CRM and sales",
    "auth": "oauth2"
  },
  {
    "id": "apollo",
    "name": "Apollo",
    "category": "crm",
    "group": "CRM and sales",
    "auth": "oauth2"
  },
  {
    "id": "intercom",
    "name": "Intercom",
    "category": "crm",
    "group": "CRM and sales",
    "auth": "oauth2"
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
    "auth": "oauth2"
  },
  {
    "id": "asana",
    "name": "Asana",
    "category": "productivity",
    "group": "Productivity and PM",
    "auth": "oauth2"
  },
  {
    "id": "trello",
    "name": "Trello",
    "category": "productivity",
    "group": "Productivity and PM",
    "auth": "oauth2"
  },
  {
    "id": "clickup",
    "name": "ClickUp",
    "category": "productivity",
    "group": "Productivity and PM",
    "auth": "oauth2"
  },
  {
    "id": "monday",
    "name": "Monday.com",
    "category": "productivity",
    "group": "Productivity and PM",
    "auth": "oauth2"
  },
  {
    "id": "todoist",
    "name": "Todoist",
    "category": "productivity",
    "group": "Productivity and PM",
    "auth": "oauth2"
  },
  {
    "id": "airtable",
    "name": "Airtable",
    "category": "productivity",
    "group": "Productivity and PM",
    "auth": "oauth2"
  },
  {
    "id": "github",
    "name": "GitHub",
    "category": "developer",
    "group": "Developer tools",
    "auth": "apiKey"
  },
  {
    "id": "gitlab",
    "name": "GitLab",
    "category": "developer",
    "group": "Developer tools",
    "auth": "apiKey"
  },
  {
    "id": "bitbucket",
    "name": "Bitbucket",
    "category": "developer",
    "group": "Developer tools",
    "auth": "apiKey"
  },
  {
    "id": "sentry",
    "name": "Sentry",
    "category": "developer",
    "group": "Developer tools",
    "auth": "apiKey"
  },
  {
    "id": "vercel",
    "name": "Vercel",
    "category": "developer",
    "group": "Developer tools",
    "auth": "apiKey"
  },
  {
    "id": "netlify",
    "name": "Netlify",
    "category": "developer",
    "group": "Developer tools",
    "auth": "apiKey"
  },
  {
    "id": "supabase",
    "name": "Supabase",
    "category": "database",
    "group": "Databases and storage",
    "auth": "connectionString"
  },
  {
    "id": "postgresql",
    "name": "PostgreSQL",
    "category": "database",
    "group": "Databases and storage",
    "auth": "connectionString"
  },
  {
    "id": "mysql",
    "name": "MySQL",
    "category": "database",
    "group": "Databases and storage",
    "auth": "connectionString"
  },
  {
    "id": "mongodb",
    "name": "MongoDB",
    "category": "database",
    "group": "Databases and storage",
    "auth": "connectionString"
  },
  {
    "id": "redis",
    "name": "Redis",
    "category": "database",
    "group": "Databases and storage",
    "auth": "connectionString"
  },
  {
    "id": "firebase",
    "name": "Firebase",
    "category": "database",
    "group": "Databases and storage",
    "auth": "connectionString"
  },
  {
    "id": "dropbox",
    "name": "Dropbox",
    "category": "database",
    "group": "Databases and storage",
    "auth": "connectionString"
  },
  {
    "id": "aws_s3",
    "name": "AWS S3",
    "category": "database",
    "group": "Databases and storage",
    "auth": "connectionString"
  },
  {
    "id": "cloudflare_r2",
    "name": "Cloudflare R2",
    "category": "database",
    "group": "Databases and storage",
    "auth": "connectionString"
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
    "auth": "apiKey"
  },
  {
    "id": "paypal",
    "name": "PayPal",
    "category": "payments",
    "group": "Payments and e-commerce",
    "auth": "apiKey"
  },
  {
    "id": "paddle",
    "name": "Paddle",
    "category": "payments",
    "group": "Payments and e-commerce",
    "auth": "apiKey"
  },
  {
    "id": "lemon_squeezy",
    "name": "Lemon Squeezy",
    "category": "payments",
    "group": "Payments and e-commerce",
    "auth": "apiKey"
  },
  {
    "id": "square",
    "name": "Square",
    "category": "payments",
    "group": "Payments and e-commerce",
    "auth": "apiKey"
  },
  {
    "id": "razorpay",
    "name": "Razorpay",
    "category": "payments",
    "group": "Payments and e-commerce",
    "auth": "apiKey"
  },
  {
    "id": "x_twitter",
    "name": "X/Twitter",
    "category": "marketing",
    "group": "Social and marketing",
    "auth": "oauth2"
  },
  {
    "id": "linkedin",
    "name": "LinkedIn",
    "category": "marketing",
    "group": "Social and marketing",
    "auth": "oauth2"
  },
  {
    "id": "facebook_pages",
    "name": "Facebook Pages",
    "category": "marketing",
    "group": "Social and marketing",
    "auth": "oauth2"
  },
  {
    "id": "instagram",
    "name": "Instagram",
    "category": "marketing",
    "group": "Social and marketing",
    "auth": "oauth2"
  },
  {
    "id": "tiktok",
    "name": "TikTok",
    "category": "marketing",
    "group": "Social and marketing",
    "auth": "oauth2"
  },
  {
    "id": "mailchimp",
    "name": "Mailchimp",
    "category": "marketing",
    "group": "Social and marketing",
    "auth": "oauth2"
  },
  {
    "id": "typeform",
    "name": "Typeform",
    "category": "marketing",
    "group": "Social and marketing",
    "auth": "oauth2"
  },
  {
    "id": "calendly",
    "name": "Calendly",
    "category": "marketing",
    "group": "Social and marketing",
    "auth": "oauth2"
  },
  {
    "id": "zendesk",
    "name": "Zendesk",
    "category": "support",
    "group": "Support and misc",
    "auth": "apiKey"
  },
  {
    "id": "freshdesk",
    "name": "Freshdesk",
    "category": "support",
    "group": "Support and misc",
    "auth": "apiKey"
  },
  {
    "id": "zoom",
    "name": "Zoom",
    "category": "support",
    "group": "Support and misc",
    "auth": "apiKey"
  },
  {
    "id": "cal_com",
    "name": "Cal.com",
    "category": "support",
    "group": "Support and misc",
    "auth": "apiKey"
  },
  {
    "id": "twilio_voice",
    "name": "Twilio Voice",
    "category": "support",
    "group": "Support and misc",
    "auth": "apiKey"
  },
  {
    "id": "docusign",
    "name": "DocuSign",
    "category": "support",
    "group": "Support and misc",
    "auth": "apiKey"
  },
  {
    "id": "rss_feed",
    "name": "RSS Feed",
    "category": "support",
    "group": "Support and misc",
    "auth": "apiKey"
  },
  {
    "id": "serpapi",
    "name": "SerpAPI",
    "category": "support",
    "group": "Support and misc",
    "auth": "apiKey"
  },
  {
    "id": "openweather",
    "name": "OpenWeather",
    "category": "support",
    "group": "Support and misc",
    "auth": "apiKey"
  }
];
