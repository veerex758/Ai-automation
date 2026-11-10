import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  createOAuthState,
  createProviderAuthorizeUrl,
  PROVIDER_OAUTH_CONFIG,
  verifyOAuthState,
  selectInstagramBusinessAccount,
  refreshProviderOAuthToken,
} from "../lib/integrations/provider-oauth";

test("provider OAuth state is signed, time-bound and bound to the provider", () => {
  const prior = process.env.AIVANTA_OAUTH_STATE_SECRET;
  process.env.AIVANTA_OAUTH_STATE_SECRET = "test-oauth-state-secret-at-least-32-bytes";
  try {
    const created = createOAuthState({ provider: "salesforce", workspaceId: "workspace-1", userId: "user-1" });
    const payload = verifyOAuthState(created.state, "salesforce");
    assert.equal(payload.workspaceId, "workspace-1");
    assert.equal(payload.userId, "user-1");
    assert.equal(typeof created.codeVerifier, "string");
    assert.equal(Object.hasOwn(payload, "codeVerifier"), false);
    assert.match(payload.codeChallenge, /^[A-Za-z0-9_-]{43}$/);
    assert.throws(() => verifyOAuthState(created.state, "dropbox"), /OAUTH_STATE_INVALID/);
    const [encoded, signature] = created.state.split(".");
    const changedSignature = (signature[0] === "a" ? "b" : "a") + signature.slice(1);
    assert.throws(() => verifyOAuthState(encoded + "." + changedSignature, "salesforce"), /OAUTH_STATE_INVALID/);
  } finally {
    if (prior === undefined) delete process.env.AIVANTA_OAUTH_STATE_SECRET;
    else process.env.AIVANTA_OAUTH_STATE_SECRET = prior;
  }
});

test("configured OAuth providers build provider-specific PKCE authorization requests", () => {
  const priorId = process.env.AIVANTA_X_TWITTER_CLIENT_ID;
  const priorSecret = process.env.AIVANTA_X_TWITTER_CLIENT_SECRET;
  process.env.AIVANTA_X_TWITTER_CLIENT_ID = "twitter-client";
  process.env.AIVANTA_X_TWITTER_CLIENT_SECRET = "twitter-secret";
  try {
    const url = new URL(createProviderAuthorizeUrl({
      provider: "x_twitter",
      config: PROVIDER_OAUTH_CONFIG.x_twitter,
      redirectUri: "https://aivanta.example.test/api/integrations/oauth/x_twitter/callback",
      state: "signed-state",
      codeVerifier: "verifier",
    }));
    assert.equal(url.origin, "https://twitter.com");
    assert.equal(url.searchParams.get("client_id"), "twitter-client");
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("state"), "signed-state");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.ok(url.searchParams.get("code_challenge"));
  } finally {
    if (priorId === undefined) delete process.env.AIVANTA_X_TWITTER_CLIENT_ID;
    else process.env.AIVANTA_X_TWITTER_CLIENT_ID = priorId;
    if (priorSecret === undefined) delete process.env.AIVANTA_X_TWITTER_CLIENT_SECRET;
    else process.env.AIVANTA_X_TWITTER_CLIENT_SECRET = priorSecret;
  }
});

test("OAuth configuration fails closed when provider client configuration is missing", () => {
  const prior = process.env.AIVANTA_SALESFORCE_CLIENT_ID;
  delete process.env.AIVANTA_SALESFORCE_CLIENT_ID;
  try {
    assert.throws(() => createProviderAuthorizeUrl({
      provider: "salesforce",
      config: PROVIDER_OAUTH_CONFIG.salesforce,
      redirectUri: "https://aivanta.example.test/callback",
      state: "state",
      codeVerifier: "verifier",
    }), /OAUTH_PROVIDER_NOT_CONFIGURED/);
  } finally {
    if (prior !== undefined) process.env.AIVANTA_SALESFORCE_CLIENT_ID = prior;
  }
});

test("Instagram business account selection requires a usable account identifier", () => {
  assert.deepEqual(selectInstagramBusinessAccount({ data: [{ id: "ig-1", username: "aivanta" }] }), { id: "ig-1", username: "aivanta" });
  assert.throws(() => selectInstagramBusinessAccount({ data: [] }), /INSTAGRAM_BUSINESS_ACCOUNT_NOT_FOUND/);
});


test("OAuth refresh rotates tokens and sends Basic-auth client credentials where required", async () => {
  const oldFetch = globalThis.fetch;
  const priorId = process.env.AIVANTA_X_TWITTER_CLIENT_ID;
  const priorSecret = process.env.AIVANTA_X_TWITTER_CLIENT_SECRET;
  process.env.AIVANTA_X_TWITTER_CLIENT_ID = "client-id";
  process.env.AIVANTA_X_TWITTER_CLIENT_SECRET = "client-secret";
  let captured: { url: string; init?: RequestInit } | undefined;
  globalThis.fetch = (async (input, init) => {
    captured = { url: String(input), init };
    return new Response(JSON.stringify({ access_token: "rotated-access", refresh_token: "rotated-refresh", expires_in: 3600, token_type: "Bearer" }), { status: 200 });
  }) as typeof fetch;
  try {
    const token = await refreshProviderOAuthToken({ provider: "x_twitter", config: PROVIDER_OAUTH_CONFIG.x_twitter, refreshToken: "old-refresh" });
    assert.equal(token.access_token, "rotated-access");
    assert.equal(token.refresh_token, "rotated-refresh");
    assert.equal(captured?.url, PROVIDER_OAUTH_CONFIG.x_twitter.tokenUrl);
    const headers = new Headers(captured?.init?.headers);
    assert.equal(headers.get("authorization"), "Basic " + Buffer.from("client-id:client-secret").toString("base64"));
    assert.equal(new URLSearchParams(String(captured?.init?.body)).get("refresh_token"), "old-refresh");
    assert.equal(new URLSearchParams(String(captured?.init?.body)).has("client_secret"), false);
  } finally {
    globalThis.fetch = oldFetch;
    if (priorId === undefined) delete process.env.AIVANTA_X_TWITTER_CLIENT_ID; else process.env.AIVANTA_X_TWITTER_CLIENT_ID = priorId;
    if (priorSecret === undefined) delete process.env.AIVANTA_X_TWITTER_CLIENT_SECRET; else process.env.AIVANTA_X_TWITTER_CLIENT_SECRET = priorSecret;
  }
});

test("OAuth refresh maps revoked credentials to an explicit reauthorization error", async () => {
  const oldFetch = globalThis.fetch;
  const priorId = process.env.AIVANTA_SALESFORCE_CLIENT_ID;
  const priorSecret = process.env.AIVANTA_SALESFORCE_CLIENT_SECRET;
  process.env.AIVANTA_SALESFORCE_CLIENT_ID = "client-id";
  process.env.AIVANTA_SALESFORCE_CLIENT_SECRET = "client-secret";
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })) as typeof fetch;
  try {
    await assert.rejects(refreshProviderOAuthToken({ provider: "salesforce", config: PROVIDER_OAUTH_CONFIG.salesforce, refreshToken: "revoked" }), /OAUTH_REAUTH_REQUIRED/);
  } finally {
    globalThis.fetch = oldFetch;
    if (priorId === undefined) delete process.env.AIVANTA_SALESFORCE_CLIENT_ID; else process.env.AIVANTA_SALESFORCE_CLIENT_ID = priorId;
    if (priorSecret === undefined) delete process.env.AIVANTA_SALESFORCE_CLIENT_SECRET; else process.env.AIVANTA_SALESFORCE_CLIENT_SECRET = priorSecret;
  }
});

test("OAuth refresh fails closed on rate limits, provider errors and malformed token responses", async () => {
  const oldFetch = globalThis.fetch;
  const priorId = process.env.AIVANTA_SALESFORCE_CLIENT_ID;
  const priorSecret = process.env.AIVANTA_SALESFORCE_CLIENT_SECRET;
  process.env.AIVANTA_SALESFORCE_CLIENT_ID = "client-id";
  process.env.AIVANTA_SALESFORCE_CLIENT_SECRET = "client-secret";
  try {
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: "rate_limited" }), { status: 429 })) as typeof fetch;
    await assert.rejects(refreshProviderOAuthToken({ provider: "salesforce", config: PROVIDER_OAUTH_CONFIG.salesforce, refreshToken: "refresh" }), /OAUTH_TOKEN_REFRESH_FAILED/);
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: "server_error" }), { status: 503 })) as typeof fetch;
    await assert.rejects(refreshProviderOAuthToken({ provider: "salesforce", config: PROVIDER_OAUTH_CONFIG.salesforce, refreshToken: "refresh" }), /OAUTH_TOKEN_REFRESH_FAILED/);
    globalThis.fetch = (async () => new Response(JSON.stringify({ expires_in: 3600 }), { status: 200 })) as typeof fetch;
    await assert.rejects(refreshProviderOAuthToken({ provider: "salesforce", config: PROVIDER_OAUTH_CONFIG.salesforce, refreshToken: "refresh" }), /OAUTH_TOKEN_RESPONSE_INVALID/);
  } finally {
    globalThis.fetch = oldFetch;
    if (priorId === undefined) delete process.env.AIVANTA_SALESFORCE_CLIENT_ID; else process.env.AIVANTA_SALESFORCE_CLIENT_ID = priorId;
    if (priorSecret === undefined) delete process.env.AIVANTA_SALESFORCE_CLIENT_SECRET; else process.env.AIVANTA_SALESFORCE_CLIENT_SECRET = priorSecret;
  }
});

test("OAuth recovery rejects expired and implausibly future-issued signed states", () => {
  const prior = process.env.AIVANTA_OAUTH_STATE_SECRET;
  const secret = "test-oauth-state-secret-at-least-32-bytes";
  process.env.AIVANTA_OAUTH_STATE_SECRET = secret;
  const sign = (payload: Record<string, unknown>) => {
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return encoded + "." + createHmac("sha256", secret).update(encoded).digest("base64url");
  };
  try {
    const now = Date.now();
    const base = { provider: "salesforce", workspaceId: "workspace-1", userId: "user-1", issuedAt: now,
      expiresAt: now + 60_000, nonce: "nonce", codeChallenge: "a".repeat(43) };
    assert.throws(() => verifyOAuthState(sign({ ...base, expiresAt: now - 1 }), "salesforce"), /OAUTH_STATE_INVALID/);
    assert.throws(() => verifyOAuthState(sign({ ...base, issuedAt: now + 31_000 }), "salesforce"), /OAUTH_STATE_INVALID/);
    assert.throws(() => verifyOAuthState(sign({ ...base, expiresAt: now + 11 * 60_000 }), "salesforce"), /OAUTH_STATE_INVALID/);
  } finally {
    if (prior === undefined) delete process.env.AIVANTA_OAUTH_STATE_SECRET; else process.env.AIVANTA_OAUTH_STATE_SECRET = prior;
  }
});

test("OAuth registry has deliberate provider-specific auth and PKCE settings", () => {
  assert.equal(PROVIDER_OAUTH_CONFIG.x_twitter.tokenAuth, "basic");
  assert.equal(PROVIDER_OAUTH_CONFIG.pipedrive.tokenAuth, "basic");
  assert.equal(PROVIDER_OAUTH_CONFIG.bitbucket.tokenAuth, "basic");
  assert.equal(PROVIDER_OAUTH_CONFIG.salesforce.pkce, false);
  assert.equal(PROVIDER_OAUTH_CONFIG.facebook_pages.tokenExchangeMode, "meta-long-lived");
  assert.equal(PROVIDER_OAUTH_CONFIG.instagram.tokenExchangeMode, "meta-long-lived");
  assert.equal(PROVIDER_OAUTH_CONFIG.tiktok.clientIdParam, "client_key");
  assert.equal(PROVIDER_OAUTH_CONFIG.tiktok.tokenResponsePath, "data");
});

test("all registered OAuth provider configs use HTTPS endpoints and declare scopes", () => {
  for (const [provider, config] of Object.entries(PROVIDER_OAUTH_CONFIG)) {
    assert.equal(new URL(config.authorizeUrl).protocol, "https:", provider + " authorize endpoint");
    assert.equal(new URL(config.tokenUrl).protocol, "https:", provider + " token endpoint");
    assert.ok(config.scopes.length > 0, provider + " scopes");
    assert.ok(config.scopes.every((scope) => typeof scope === "string" && scope.trim().length > 0), provider + " scope values");
    assert.equal(config.clientIdEnv, "AIVANTA_" + provider.toUpperCase() + "_CLIENT_ID");
    assert.equal(config.clientSecretEnv, "AIVANTA_" + provider.toUpperCase() + "_CLIENT_SECRET");
  }
});

test("OAuth refresh rotates tokens when the provider returns a replacement and uses Basic auth where required", async () => {
  const oldFetch = globalThis.fetch;
  const priorId = process.env.AIVANTA_X_TWITTER_CLIENT_ID;
  const priorSecret = process.env.AIVANTA_X_TWITTER_CLIENT_SECRET;
  process.env.AIVANTA_X_TWITTER_CLIENT_ID = "client-id";
  process.env.AIVANTA_X_TWITTER_CLIENT_SECRET = "client-secret";
  let captured: { url: string; init?: RequestInit } | undefined;
  globalThis.fetch = (async (input, init) => {
    captured = { url: String(input), init };
    return new Response(JSON.stringify({ access_token: "rotated-access", refresh_token: "rotated-refresh", expires_in: 3600, token_type: "Bearer" }), { status: 200 });
  }) as typeof fetch;
  try {
    const token = await refreshProviderOAuthToken({ provider: "x_twitter", config: PROVIDER_OAUTH_CONFIG.x_twitter, refreshToken: "old-refresh" });
    assert.equal(token.access_token, "rotated-access");
    assert.equal(token.refresh_token, "rotated-refresh");
    assert.equal(captured?.url, PROVIDER_OAUTH_CONFIG.x_twitter.tokenUrl);
    const headers = new Headers(captured?.init?.headers);
    assert.equal(headers.get("authorization"), "Basic " + Buffer.from("client-id:client-secret").toString("base64"));
    assert.equal(new URLSearchParams(String(captured?.init?.body)).get("refresh_token"), "old-refresh");
    assert.equal(new URLSearchParams(String(captured?.init?.body)).has("client_secret"), false);
  } finally {
    globalThis.fetch = oldFetch;
    if (priorId === undefined) delete process.env.AIVANTA_X_TWITTER_CLIENT_ID; else process.env.AIVANTA_X_TWITTER_CLIENT_ID = priorId;
    if (priorSecret === undefined) delete process.env.AIVANTA_X_TWITTER_CLIENT_SECRET; else process.env.AIVANTA_X_TWITTER_CLIENT_SECRET = priorSecret;
  }
});
