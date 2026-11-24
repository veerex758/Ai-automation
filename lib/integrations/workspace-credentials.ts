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
  microsoft_teams: ["accessToken", "refreshToken", "expiresAt", "tokenType", "scope"], salesforce: ["accessToken", "instanceUrl", "refreshToken", "expiresAt", "tokenType", "scope"], pipedrive: ["accessToken", "refreshToken", "expiresAt", "tokenType", "scope"],
  zoho_crm: ["accessToken", "refreshToken", "expiresAt", "tokenType", "scope"], freshsales: ["accessToken", "domain", "refreshToken", "expiresAt", "tokenType", "scope"], close: ["apiKey", "refreshToken", "expiresAt", "tokenType", "scope"], apollo: ["apiKey", "refreshToken", "expiresAt", "tokenType", "scope"], intercom: ["accessToken", "refreshToken", "expiresAt", "tokenType", "scope"],
  jira: ["siteUrl", "email", "apiToken"], asana: ["accessToken", "refreshToken", "expiresAt", "tokenType", "scope"], trello: ["apiKey", "token"], clickup: ["token"],
  monday: ["apiToken"], todoist: ["accessToken", "refreshToken", "expiresAt", "tokenType", "scope"], airtable: ["accessToken"], bitbucket: ["accessToken", "refreshToken", "expiresAt", "tokenType", "scope"], netlify: ["token"],
  woocommerce: ["storeUrl", "consumerKey", "consumerSecret"], paypal: ["clientId", "clientSecret", "environment"],
  paddle: ["apiKey"], lemon_squeezy: ["apiKey", "storeId"], square: ["accessToken", "environment"],
  razorpay: ["keyId", "keySecret"], zoom: ["accessToken"], cal_com: ["apiKey"],
  twilio_voice: ["accountSid", "authToken", "fromPhone"], docusign: ["accessToken", "accountId", "baseUri"],
  supabase: ["projectUrl", "apiKey"], postgresql: ["connectionString"], mysql: ["connectionString"], mongodb: ["connectionString"], redis: ["restUrl", "token"],
  firebase: ["projectId", "accessToken"], dropbox: ["accessToken", "refreshToken", "expiresAt", "tokenType", "scope"],
  aws_s3: ["accessKeyId", "secretAccessKey", "region"], cloudflare_r2: ["accountId", "accessKeyId", "secretAccessKey"],
  x_twitter: ["accessToken", "refreshToken", "expiresAt", "tokenType", "scope"], linkedin: ["accessToken", "refreshToken", "expiresAt", "tokenType", "scope"], facebook_pages: ["pageAccessToken", "refreshToken", "expiresAt", "tokenType", "accessToken", "scope"],
  instagram: ["accessToken", "igUserId", "refreshToken", "expiresAt", "tokenType", "scope"], tiktok: ["accessToken", "refreshToken", "expiresAt", "tokenType", "scope"], mailchimp: ["apiKey"], typeform: ["accessToken"],
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
      woocommerce: ["storeUrl", "consumerKey", "consumerSecret"], paypal: ["clientId", "clientSecret", "environment"],
      paddle: ["apiKey"], lemon_squeezy: ["apiKey", "storeId"], square: ["accessToken", "environment"],
      razorpay: ["keyId", "keySecret"], zoom: ["accessToken"], cal_com: ["apiKey"],
      twilio_voice: ["accountSid", "authToken", "fromPhone"], docusign: ["accessToken", "accountId", "baseUri"],
      supabase: ["projectUrl", "apiKey"], postgresql: ["connectionString"], mysql: ["connectionString"], mongodb: ["connectionString"], redis: ["restUrl", "token"],
      firebase: ["projectId", "accessToken"], dropbox: ["accessToken"],
      aws_s3: ["accessKeyId", "secretAccessKey", "region"], cloudflare_r2: ["accountId", "accessKeyId", "secretAccessKey"],
      x_twitter: ["accessToken"], linkedin: ["accessToken"], facebook_pages: ["pageAccessToken"],
      instagram: ["accessToken", "igUserId"], tiktok: ["accessToken"], mailchimp: ["apiKey"], typeform: ["accessToken"],
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


function encryptCredentialEnvelope(version: "v1" | "v2", credentials: WorkspaceCredentials, encodedKey: string | undefined, associatedData?: string): string {
  if (!encodedKey) throw new Error("WORKSPACE_CREDENTIAL_ENCRYPTION_NOT_CONFIGURED");
  if (version === "v2" && (!associatedData || !associatedData.trim())) throw new Error("WORKSPACE_CREDENTIAL_ASSOCIATED_DATA_REQUIRED");
  const validated = validateCredentials(credentials);
  const plaintext = Buffer.from(JSON.stringify(validated), "utf8");
  if (plaintext.length > MAX_CREDENTIAL_BYTES) throw new Error("WORKSPACE_CREDENTIALS_TOO_LARGE");
  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== KEY_BYTES) throw new Error("WORKSPACE_CREDENTIAL_ENCRYPTION_KEY_INVALID");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  if (associatedData) cipher.setAAD(Buffer.from(associatedData, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return [version, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function encryptWorkspaceCredentials(credentials: WorkspaceCredentials, encodedKey = process.env.AIVANTA_CREDENTIALS_ENCRYPTION_KEY, associatedData?: string): string {
  return encryptCredentialEnvelope("v1", credentials, encodedKey, associatedData);
}

export type WorkspaceCredentialKeyring = {
  activeKeyId: string;
  keys: Record<string, Buffer>;
};

export function parseWorkspaceCredentialKeyring(
  raw = process.env.AIVANTA_CREDENTIALS_ENCRYPTION_KEYRING,
): WorkspaceCredentialKeyring | null {
  if (!raw) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("WORKSPACE_CREDENTIAL_KEYRING_INVALID"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("WORKSPACE_CREDENTIAL_KEYRING_INVALID");
  const candidate = parsed as Record<string, unknown>;
  if (typeof candidate.activeKeyId !== "string" ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(candidate.activeKeyId) ||
      !candidate.keys || typeof candidate.keys !== "object" || Array.isArray(candidate.keys)) {
    throw new Error("WORKSPACE_CREDENTIAL_KEYRING_INVALID");
  }
  const entries = Object.entries(candidate.keys as Record<string, unknown>);
  if (entries.length < 1 || entries.length > 16) throw new Error("WORKSPACE_CREDENTIAL_KEYRING_INVALID");
  const keys = Object.create(null) as Record<string, Buffer>;
  const seenKeyMaterial = new Set<string>();
  for (const [keyId, encoded] of entries) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(keyId) || typeof encoded !== "string") throw new Error("WORKSPACE_CREDENTIAL_KEYRING_INVALID");
    const key = Buffer.from(encoded, "base64");
    if (key.length !== KEY_BYTES || key.toString("base64") !== encoded) throw new Error("WORKSPACE_CREDENTIAL_KEYRING_INVALID");
    const fingerprint = key.toString("hex");
    if (seenKeyMaterial.has(fingerprint)) throw new Error("WORKSPACE_CREDENTIAL_KEYRING_DUPLICATE_KEY");
    seenKeyMaterial.add(fingerprint);
    keys[keyId] = key;
  }
  if (!Object.hasOwn(keys, candidate.activeKeyId)) throw new Error("WORKSPACE_CREDENTIAL_KEYRING_ACTIVE_KEY_MISSING");
  return { activeKeyId: candidate.activeKeyId, keys };
}

export function getActiveWorkspaceCredentialKeyId(): string | null {
  return parseWorkspaceCredentialKeyring()?.activeKeyId ?? null;
}

export function encryptWorkspaceCredentialsV3(
  credentials: WorkspaceCredentials,
  associatedData: string,
  rawKeyring = process.env.AIVANTA_CREDENTIALS_ENCRYPTION_KEYRING,
): string {
  if (!associatedData || !associatedData.trim()) throw new Error("WORKSPACE_CREDENTIAL_ASSOCIATED_DATA_REQUIRED");
  const keyring = parseWorkspaceCredentialKeyring(rawKeyring);
  if (!keyring) throw new Error("WORKSPACE_CREDENTIAL_KEYRING_NOT_CONFIGURED");
  const plaintext = Buffer.from(JSON.stringify(validateCredentials(credentials)), "utf8");
  if (plaintext.length > MAX_CREDENTIAL_BYTES) throw new Error("WORKSPACE_CREDENTIALS_TOO_LARGE");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyring.keys[keyring.activeKeyId], iv);
  cipher.setAAD(Buffer.from(associatedData + "\u0000v3\u0000" + keyring.activeKeyId, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return ["v3", keyring.activeKeyId, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

/** New writes use v3 when the dual-key keyring is configured; otherwise keep v2 compatibility. */
export function encryptWorkspaceCredentialsV2(
  credentials: WorkspaceCredentials,
  associatedData: string,
  encodedKey = process.env.AIVANTA_CREDENTIALS_ENCRYPTION_KEY,
): string {
  if (process.env.AIVANTA_CREDENTIALS_ENCRYPTION_KEYRING) {
    return encryptWorkspaceCredentialsV3(credentials, associatedData);
  }
  return encryptCredentialEnvelope("v2", credentials, encodedKey, associatedData);
}

export function decryptWorkspaceCredentials(
  envelope: string,
  encodedKey = process.env.AIVANTA_CREDENTIALS_ENCRYPTION_KEY,
  associatedData?: string,
): WorkspaceCredentials {
  if (typeof envelope !== "string" || envelope.length > MAX_CREDENTIAL_BYTES * 2) throw new Error("WORKSPACE_CREDENTIAL_ENVELOPE_INVALID");
  const parts = envelope.split(".");
  const version = parts[0];

  if (version === "v3") {
    const [, keyId, ivValue, tagValue, encryptedValue, extra] = parts;
    if (parts.length !== 5 || !keyId || !/^[A-Za-z0-9_-]{1,64}$/.test(keyId) || !ivValue || !tagValue || !encryptedValue || extra) {
      throw new Error("WORKSPACE_CREDENTIAL_ENVELOPE_INVALID");
    }
    if (!associatedData || !associatedData.trim()) throw new Error("WORKSPACE_CREDENTIAL_ASSOCIATED_DATA_REQUIRED");
    const keyring = parseWorkspaceCredentialKeyring();
    const key = keyring?.keys[keyId];
    if (!key) throw new Error("WORKSPACE_CREDENTIAL_KEY_VERSION_UNAVAILABLE");
    const iv = Buffer.from(ivValue, "base64url"), tag = Buffer.from(tagValue, "base64url"), ciphertext = Buffer.from(encryptedValue, "base64url");
    if (iv.length !== 12 || tag.length !== 16 || ciphertext.length < 1 || ciphertext.length > MAX_CREDENTIAL_BYTES) {
      throw new Error("WORKSPACE_CREDENTIAL_ENVELOPE_INVALID");
    }
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(associatedData + "\u0000v3\u0000" + keyId, "utf8"));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    let parsed: unknown;
    try { parsed = JSON.parse(plaintext.toString("utf8")); } catch { throw new Error("WORKSPACE_CREDENTIALS_INVALID"); }
    return validateCredentials(parsed);
  }

  if (version !== "v1" && version !== "v2") throw new Error("WORKSPACE_CREDENTIAL_ENVELOPE_INVALID");
  if (!encodedKey) throw new Error("WORKSPACE_CREDENTIAL_ENCRYPTION_NOT_CONFIGURED");
  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== KEY_BYTES) throw new Error("WORKSPACE_CREDENTIAL_ENCRYPTION_KEY_INVALID");
  const [, ivValue, tagValue, encryptedValue, extra] = parts;
  if (!ivValue || !tagValue || !encryptedValue || extra) throw new Error("WORKSPACE_CREDENTIAL_ENVELOPE_INVALID");
  if (version === "v2" && (!associatedData || !associatedData.trim())) throw new Error("WORKSPACE_CREDENTIAL_ASSOCIATED_DATA_REQUIRED");
  const iv = Buffer.from(ivValue, "base64url"), tag = Buffer.from(tagValue, "base64url"), ciphertext = Buffer.from(encryptedValue, "base64url");
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length < 1 || ciphertext.length > MAX_CREDENTIAL_BYTES) {
    throw new Error("WORKSPACE_CREDENTIAL_ENVELOPE_INVALID");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  if (associatedData) decipher.setAAD(Buffer.from(associatedData, "utf8"));
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  let parsed: unknown;
  try { parsed = JSON.parse(plaintext.toString("utf8")); } catch { throw new Error("WORKSPACE_CREDENTIALS_INVALID"); }
  return validateCredentials(parsed);
}
