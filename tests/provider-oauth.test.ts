import test from "node:test";
import assert from "node:assert/strict";
import { nodes } from "../nodes/registry";
import { encryptWorkspaceCredentials, decryptWorkspaceCredentials } from "../lib/integrations/workspace-credentials";
import {
  exchangeMetaLongLivedToken,
  createOAuthState,
  createProviderAuthorizeUrl,
  PROVIDER_OAUTH_CONFIG,
  verifyOAuthState,
  selectInstagramBusinessAccount,
} from "../lib/integrations/provider-oauth";

test("provider OAuth state is signed, time-bound and bound to the provider", () => {
  process.env.AIVANTA_OAUTH_STATE_SECRET = "test-oauth-state-secret-at-least-32-bytes";
  const created = createOAuthState({ provider: "salesforce", workspaceId: "workspace-1", userId: "user-1" });
  const payload = verifyOAuthState(created.state, "salesforce");
  assert.equal(payload.workspaceId, "workspace-1");
  assert.equal(payload.userId, "user-1");
  assert.equal(typeof payload.codeVerifier, "string");
  assert.throws(() => verifyOAuthState(created.state, "dropbox"), /OAUTH_STATE_INVALID/);
  const [encoded, signature] = created.state.split(".");
  const changedSignature = (signature[0] === "a" ? "b" : "a") + signature.slice(1);
  assert.throws(() => verifyOAuthState(encoded + "." + changedSignature, "salesforce"), /OAUTH_STATE_INVALID/);
});

test("configured OAuth providers build provider-specific PKCE authorization requests", () => {
  process.env.AIVANTA_X_TWITTER_CLIENT_ID = "twitter-client";
  process.env.AIVANTA_X_TWITTER_CLIENT_SECRET = "twi¶»§q«^