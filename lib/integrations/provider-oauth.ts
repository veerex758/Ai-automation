import { createHmac, randomBytes, timingSafeEqual, createHash } from "node:crypto";

export type ProviderOAuthConfig = {
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  clientIdEnv: string;
  clientSecretEnv: string;
  clientIdParam?: string;
  tokenAuth?: "body" | "basic";
  pkce?: boolean;
  authorizeParams?: Record<string, string>;
  tokenResponsePath?: "data";
  includeTokenScope?: boolean;
  tokenExchangeMode?: "meta-long-lived";
};

const oauthConfig = (provider: string, authorizeUrl: string, tokenUrl: string, scopes: string[], options: Partial<ProviderOAuthConfig> = {}): ProviderOAuthConfig => ({
  authorizeUrl, tokenUrl, scopes,
  clientIdEnv: "AIVANTA_" + provider.toUpperCase() + "_CLIENT_ID",
  clientSecretEnv: "AIVANTA_" + provider.toUpperCase() + "_CLIENT_SECRET",
  pkce: true,
  ...options,
});

export const PROVIDER_OAUTH_CONFIG: Readonly<Record<string, ProviderOAuthConfig>> = {
  microsoft_teams: oauthConfig("microsoft_teams", "https://login.microsoftonline.com/common/oauth2/v2.0/authorize", "https://login.microsoftonline.com/common/oauth2/v2.0/token", ["offline_access", "User.Read", "ChannelMessage.Send"], { includeTokenScope: true }),
  salesforce: oauthConfig("salesforce", "https://login.salesforce.com/services/oauth2/authorize", "https://login.salesforce.com/services/oauth2/token", ["api", "refresh_token"], { pkce: false, tokenAuth: "body" }),
  pipedrive: oauthConfig("pipedrive", "https://oauth.pipedrive.com/oauth/authorize", "https://oauth.pipedrive.com/oauth/token", ["base", "deals:read", "persons:read"], { tokenAuth: "basic" }),
  zoho_crm: oauthConfig("zoho_crm", "https://accounts.zoho.com/oauth/v2/auth", "https://accounts.zoho.com/oauth/v2/token", ["ZohoCRM.modules.ALL", "offline_access"], { authorizeParams: { access_type: "offline" } }),
  freshsales: oauthConfig("freshsales", "https://accounts.freshworks.com/oauth/authorize", "https://accounts.freshworks.com/oauth/token", ["crm:contacts:read", "crm:deals:read"], { tokenAuth: "basic" }),
  close: oauthConfig("close", "https://app.close.com/oauth2/authorize/", "https://api.close.com/oauth2/token/"),
  apollo: oauthConfig("apollo", "https://app.apollo.io/#/oauth/authorize", "https://api.apollo.io/v1/oauth/token", ["contacts:read"], { pkce: false }),
  intercom: oauthConfig("intercom", "https://app.intercom.com/oauth", "https://api.intercom.io/auth/eagle/token", ["read_contacts", "read_conversations"]),
  x_twitter: oauthConfig("x_twitter", "https://twitter.com/i/oauth2/authorize", "https://api.twitter.com/2/oauth2/token", ["tweet.read", "users.read", "offline.access"], { tokenAuth: "basic" }),
  linkedin: oauthConfig("linkedin", "https://www.linkedin.com/oauth/v2/authorization", "https://www.linkedin.com/oauth/v2/accessToken", ["openid", "profile", "email", "w_member_social"], { tokenAuth: "body" }),
  facebook_pages: oauthConfig("facebook_pages", "https://www.facebook.com/v21.0/dialog/oauth", "https://graph.facebook.com/v21.0/oauth/access_token", ["pages_show_list", "pages_read_engagement", "pages_manage_posts"], { pkce: false, tokenExchangeMode: "meta-long-lived" }),
  instagram: oauthConfig("instagram", "https://www.facebook.com/v21.0/dialog/oauth", "https://graph.facebook.com/v21.0/oauth/access_token", ["instagram_basic", "instagram_content_publish", "pages_show_list"], { pkce: false, tokenExchangeMode: "meta-long-lived" }),
  tiktok: oauthConfig("tiktok", "https://www.tiktok.com/v2/auth/authorize/", "https://open.tiktokapis.com/v2/oauth/token/", ["user.info.basic", "video.list"], { clientIdParam: "client_key", tokenAuth: "body" }),
  dropbox: oauthConfig("dropbox", "https://www.dropbox.com/oauth2/authorize", "https://api.dropboxapi.com/oauth2/token", ["account_info.read", "files.metadata.read", "files.content.read"], { authorizeParams: { token_access_type: "offline" } }),
  asana: oauthConfig("asana", "https://app.asana.com/-/oauth_authorize", "https://app.asana.com/-/oauth_token", ["default"], { tokenAuth: "body" }),
  todoist: oauthConfig("todoist", "https://todoist.com/oauth/authorize", "https://todoist.com/oauth/access_token", ["data:read_write"], { tokenAuth: "body" }),
  bitbucket: oauthConfig("bitbucket", "https://bitbucket.org/site/oauth2/authorize", "https://bitbucket.org/site/oauth2/access_token", ["repository", "pullrequest"], { tokenAuth: "basic" }),
};

type OAuthStatePayload = {
  provider: string;
  workspaceId: string;
  userId: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
  codeVerifier: string;
};

function stateSecret(): string {
  const secret = process.env.AIVANTA_OAUTH_STATE_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) throw new Error("OAUTH_STATE_SECRET_NOT_CONFIGURED");
  return secret;
}

function stateSignature(encoded: string): Buffer {
  return createHmac("sha256", stateSecret()).update(encoded).digest();
}

export function createOAuthState(args: { provider: string; workspaceId: string; userId: string }): { state: string; codeVerifier: string } {
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(args.provider) || !args.workspaceId || !args.userId) throw new Error("OAUTH_STATE_INVALID");
  const now = Date.now();
  const codeVerifier = randomBytes(32).toString("base64url");
  const payload: OAuthStatePayload = {
    provider: args.provider,
    workspaceId: args.workspaceId,
    userId: args.userId,
    issuedAt: now,
    expiresAt: now + 10 * 60 * 1000,
    nonce: randomBytes(16).toString("base64url"),
    codeVerifier,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return { state: encoded + "." + stateSignature(encoded).toString("base64url"), codeVerifier };
}

export function verifyOAuthState(state: string, expectedProvider: string): OAuthStatePayload {
  if (typeof state !== "string" || state.length > 4096) throw new Error("OAUTH_STATE_INVALID");
  const parts = state.split(".");
  if (parts.length !== 2) throw new Error("OAUTH_STATE_INVALID");
  const [encoded, supplied] = parts;
  let signature: Buffer;
  try { signature = Buffer.from(supplied, "base64url"); } catch { throw new Error("OAUTH_STATE_INVALID"); }
  const expected = stateSignature(encoded);
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) throw new Error("OAUTH_STATE_INVALID");
  let payload: OAuthStatePayload;
  try { payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as OAuthStatePayload; } catch { throw new Error("OAUTH_STATE_INVALID"); }
  const now = Date.now();
  if (!payload || payload.provider !== expectedProvider || !payload.workspaceId || !payload.userId ||
      !payload.nonce || !payload.codeVerifier || !Number.isFinite(payload.issuedAt) ||
      !Number.isFinite(payload.expiresAt) || payload.expiresAt <= now ||
      payload.issuedAt > now + 30_000 || payload.expiresAt - payload.issuedAt > 10 * 60 * 1000) {
    throw new Error("OAUTH_STATE_INVALID");
  }
  return payload;
}

export function createProviderAuthorizeUrl(args: {
  provider: string;
  config: ProviderOAuthConfig;
  redirectUri: string;
  state: string;
  codeVerifier: string;
}): string {
  const clientId = process.env[args.config.clientIdEnv];
  if (!clientId) throw new Error("OAUTH_PROVIDER_NOT_CONFIGURED");
  const url = new URL(args.config.authorizeUrl);
  url.searchParams.set(args.config.clientIdParam ?? "client_id", clientId);
  url.searchParams.set("redirect_uri", args.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", args.state);
  if (args.config.scopes.length) url.searchParams.set("scope", args.config.scopes.join(" "));
  for (const [key, value] of Object.entries(args.config.authorizeParams ?? {})) url.searchParams.set(key, value);
  if (args.config.pkce !== false) {
    const challenge = createHash("sha256").update(args.codeVerifier).digest("base64url");
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
  }
  return url.toString();
}

export type OAuthTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  instance_url?: string;
  [key: string]: unknown;
};

export async function exchangeProviderOAuthCode(args: {
  provider: string;
  config: ProviderOAuthConfig;
  code: string;
  redirectUri: string;
  codeVerifier?: string;
}): Promise<OAuthTokenResponse> {
  const clientId = process.env[args.config.clientIdEnv];
  const clientSecret = process.env[args.config.clientSecretEnv];
  if (!clientId || !clientSecret) throw new Error("OAUTH_PROVIDER_NOT_CONFIGURED");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: args.code,
    redirect_uri: args.redirectUri,
    ...(args.config.clientIdParam === "client_key" ? { client_key: clientId } : { client_id: clientId }),
    client_secret: clientSecret,
  });
  if (args.codeVerifier && args.config.pkce !== false) body.set("code_verifier", args.codeVerifier);
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };
  if (args.config.tokenAuth === "basic") {
    headers.Authorization = "Basic " + Buffer.from(clientId + ":" + clientSecret).toString("base64");
    body.delete("client_secret");
    body.delete("client_id");
    body.delete("client_key");
  }
  const response = await fetch(args.config.tokenUrl, { method: "POST", headers, body, redirect: "error", signal: AbortSignal.timeout(15000) });
  const raw = await response.json().catch(() => null) as unknown;
  if (!response.ok || !raw || typeof raw !== "object") throw new Error(response.status === 429 ? "OAUTH_PROVIDER_RATE_LIMITED" : "OAUTH_TOKEN_EXCHANGE_FAILED");
  const payload = args.config.tokenResponsePath === "data" ? (raw as { data?: unknown }).data : raw;
  if (!payload || typeof payload !== "object" || typeof (payload as Record<string, unknown>).access_token !== "string") throw new Error("OAUTH_TOKEN_RESPONSE_INVALID");
  return payload as OAuthTokenResponse;
}

export async function exchangeMetaLongLivedToken(args: {
  provider: string;
  accessToken: string;
  config: ProviderOAuthConfig;
}): Promise<OAuthTokenResponse> {
  const clientId = process.env[args.config.clientIdEnv];
  const clientSecret = process.env[args.config.clientSecretEnv];
  if (!clientId || !clientSecret || !args.accessToken) throw new Error("OAUTH_PROVIDER_NOT_CONFIGURED");
  const url = new URL("https://graph.facebook.com/v21.0/oauth/access_token");
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("client_secret", clientSecret);
  url.searchParams.set("fb_exchange_token", args.accessToken);
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15000) });
  const payload = await response.json().catch(() => null) as unknown;
  if (!response.ok || !payload || typeof payload !== "object" || typeof (payload as Record<string, unknown>).access_token !== "string") {
    throw new Error("OAUTH_LONG_LIVED_TOKEN_EXCHANGE_FAILED");
  }
  return payload as OAuthTokenResponse;
}

export function selectInstagramBusinessAccount(accounts: unknown): { id: string; username?: string } {
  const list = Array.isArray(accounts) ? accounts : accounts && typeof accounts === "object" && Array.isArray((accounts as Record<string, unknown>).data)
    ? (accounts as { data: unknown[] }).data : [];
  const selected = list.find((item) => item && typeof item === "object" && typeof (item as Record<string, unknown>).id === "string") as Record<string, unknown> | undefined;
  if (!selected) throw new Error("INSTAGRAM_BUSINESS_ACCOUNT_NOT_FOUND");
  return { id: selected.id as string, ...(typeof selected.username === "string" ? { username: selected.username } : {}) };
}
