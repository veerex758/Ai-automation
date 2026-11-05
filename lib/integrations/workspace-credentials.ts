import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type WorkspaceCredentialProvider =
  | "openai" | "gemini" | "resend" | "slack" | "http"
  | "notion" | "hubspot" | "twilio" | "shopify" | "stripe" | "linear" | "claude" | "mistral" | "groq" | "perplexity" | "discord" | "telegram" | "whatsapp_business" | "sendgrid" | "mailgun" | "postmark" | "github" | "gitlab" | "sentry" | "vercel" | "calendly" | "zendesk" | "freshdesk" | "serpapi" | "openweather" | "elevenlabs" | "stability_ai" | "hugging_face" | "pinecone" | "microsoft_teams" | "salesforce" | "pipedrive" | "zoho_crm" | "freshsales" | "close" | "apollo" | "intercom" | "jira" | "asana" | "trello" | "clickup" | "monday" | "todoist" | "airtable" | "bitbucket" | "netlify";
export type WorkspaceCredentials = Record<string, Record<string, string>>;

const KEY_BYTES = 32;
const MAX_CREDENTIAL_BYTES = 32 * 1024;
const PROVIDER_FIELDS: Record<WorkspaceCredentialProvider, readonly string[]> = {
  openai: ["apiKey"],
  gemini: ["apiKey"],
  resend: ["apiKey", "fromEmail"],
  slack: ["webhookUrl", "botToken"],
  http: ["apiKey", "username", "password", "baseUrl"],
  notion: ["apiKey"],
  hubspot: ["accessToken"],
  twilio: ["accountSid", "authToken", "fromPhone"],
  shopify: ["shopDomain", "accessToken"],
  stripe: ["secretKey"],
  linear: ["apiKey"],
  claude: ["apiKey"],
  mistral: ["apiKey"],
  groq: ["apiKey"],
  perplexity: ["apiKey"],
  discord: ["botToken"],
  telegram: ["botToken"],
  whatsapp_business: ["accessToken", "phoneNumberId"],
  sendgrid: ["apiKey", "fromEmail"],
  mailgun: ["apiKey", "domain", "fromEmail"],
  postmark: ["serverToken", "fromEmail"],
  github: ["token"],
  gitlab: ["token"],
  sentry: ["authToken"],
  vercel: ["token"],
  calendly: ["accessToken"],
  zendesk: ["subdomain", "email", "apiToken"],
  freshdesk: ["domain", "apiKey"],
  serpapi: ["apiKey"],
  openweather: ["apiKey"],
  elevenlabs: ["apiKey"],
  stability_ai: ["apiKey"],
  hugging_face: ["apiKey"],
  pinecone: ["apiKey", "indexHost"],
  microsoft_teams: ["accessToken"], salesforce: ["accessToken", "instanceUrl"], pipedrive: ["accessToken"],
  zoho_crm: ["accessToken"], freshsales: ["accessToken", "domain"], close: ["apiKey"], apollo: ["apiKey"], intercom: ["accessToken"],
};

function validateCredentials(value: unknown): WorkspaceCredentials {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("WORKSPACE_CREDENTIALS_INVALID");
  const result: WorkspaceCredentials = {};
  for (const [provider, raw] of Object.entries(value)) {
    if (!Object.hasOwn(PROVIDER_FIELDS, provider) || !raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("WORKSPACE_CREDENTIALS_INVALID");
    }
    const fields = PROVIDER_FIELDS[provider as WorkspaceCredentialProvider];
    const credentials: Record<string, string> = {};
    for (const [field, secret] of Object.entries(raw)) {
      if (!fields.includes(field) || typeof secret !== "string" || !secret.trim() || secret.length > 8192) {
        throw new Error("WORKSPACE_CREDENTIALS_INVALID");
      }
      credentials[field] = secret;
    }
    if (Object.keys(credentials).length === 0) throw new Error("WORKSPACE_CREDENTIALS_INVALID");
    const requiredFields: Partial<Record<WorkspaceCredentialProvider, readonly string[]>> = {
      openai: ["apiKey"], gemini: ["apiKey"], resend: ["apiKey", "fromEmail"],
      claude: ["apiKey"],
      mistral: ["apiKey"],
      groq: ["apiKey"],
      perplexity: ["apiKey"],
      discord: ["botToken"],
      telegram: ["botToken"],
      whatsapp_business: ["accessToken", "phoneNumberId"],
      sendgrid: ["apiKey", "fromEmail"],
      mailgun: ["apiKey", "domain", "fromEmail"],
      postmark: ["serverToken", "fromEmail"],
      github: ["token"],
      gitlab: ["token"],
      sentry: ["authToken"],
      vercel: ["token"],
      calendly: ["accessToken"],
      zendesk: ["subdomain", "email", "apiToken"],
      freshdesk: ["domain", "apiKey"],
      serpapi: ["apiKey"],
      openweather: ["apiKey"],
      elevenlabs: ["apiKey"], stability_ai: ["apiKey"], hugging_face: ["apiKey"], pinecone: ["apiKey", "indexHost"],
      microsoft_teams: ["accessToken"], salesforce: ["accessToken", "instanceUrl"], pipedrive: ["accessToken"],
      zoho_crm: ["accessToken"], freshsales: ["accessToken", "domain"], close: ["apiKey"], apollo: ["apiKey"], intercom: ["accessToken"],
      jira: ["siteUrl", "email", "apiToken"], asana: ["accessToken"], trello: ["apiKey", "token"], clickup: ["token"],
      monday: ["apiToken"], todoist: ["accessToken"], airtable: ["accessToken"], bitbucket: ["accessToken"], netlify: ["token"],
      notion: ["apiKey"], hubspot: ["accessToken"],
      twilio: ["accountSid", "authToken", "fromPhone"],
      shopify: ["shopDomain", "accessToken"], stripe: ["secretKey"], linear: ["apiKey"],
    };
    if (requiredFields[provider as WorkspaceCredentialProvider]?.some((field) => !credentials[field])) {
      throw new Error("WORKSPACE_CREDENTIALS_INVALID");
    }
    if (provider === "slack" && !credentials.webhookUrl && !credentials.botToken) {
      throw new Error("WORKSPACE_CREDENTIALS_INVALID");
    }
    result[provider] = credentials;
  }
  return result;
}

/** Encrypt workspace provider credentials using the versioned AES-256-GCM envelope. */
export function encryptWorkspaceCredentials(credentials: WorkspaceCredentials, encodedKey = process.env.AIVANTA_CREDENTIALS_ENCRYPTION_KEY, associatedData?: string): string {
  if (!encodedKey) throw new Error("WORKSPACE_CREDENTIAL_ENCRYPTION_NOT_CONFIGURED");
  const validated = validateCredentials(credentials);
  const plaintext = Buffer.from(JSON.stringify(validated), "utf8");
  if (plaintext.length > MAX_CREDENTIAL_BYTES) throw new Error("WORKSPACE_CREDENTIALS_TOO_LARGE");
  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== KEY_BYTES) throw new Error("WORKSPACE_CREDENTIAL_ENCRYPTION_KEY_INVALID");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  if (associatedData) cipher.setAAD(Buffer.from(associatedData, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

/** Decrypt and strictly validate credentials read from workspace_integration_secrets. */
export function decryptWorkspaceCredentials(envelope: string, encodedKey = process.env.AIVANTA_CREDENTIALS_ENCRYPTION_KEY, associatedData?: string): WorkspaceCredentials {
  if (!encodedKey) throw new Error("WORKSPACE_CREDENTIAL_ENCRYPTION_NOT_CONFIGURED");
  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== KEY_BYTES) throw new Error("WORKSPACE_CREDENTIAL_ENCRYPTION_KEY_INVALID");
  if (typeof envelope !== "string" || envelope.length > MAX_CREDENTIAL_BYTES * 2) throw new Error("WORKSPACE_CREDENTIAL_ENVELOPE_INVALID");
  const [version, ivValue, tagValue, encryptedValue, extra] = envelope.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !encryptedValue || extra) throw new Error("WORKSPACE_CREDENTIAL_ENVELOPE_INVALID");
  const iv = Buffer.from(ivValue, "base64url");
  const tag = Buffer.from(tagValue, "base64url");
  const ciphertext = Buffer.from(encryptedValue, "base64url");
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length < 1 || ciphertext.length > MAX_CREDENTIAL_BYTES) throw new Error("WORKSPACE_CREDENTIAL_ENVELOPE_INVALID");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  if (associatedData) decipher.setAAD(Buffer.from(associatedData, "utf8"));
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  let parsed: unknown;
  try { parsed = JSON.parse(plaintext.toString("utf8")); } catch { throw new Error("WORKSPACE_CREDENTIALS_INVALID"); }
  return validateCredentials(parsed);
}
