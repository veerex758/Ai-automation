import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const connect = readFileSync(new URL("../app/api/integrations/google/connect/route.ts", import.meta.url), "utf8");
const callback = readFileSync(new URL("../app/api/integrations/google/callback/route.ts", import.meta.url), "utf8");
const status = readFileSync(new URL("../app/api/integrations/google/status/route.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20261101090000_google_workspace_oauth_connections.sql", import.meta.url), "utf8");
const ui = readFileSync(new URL("../app/dashboard/integrations/google-oauth-connections.tsx", import.meta.url), "utf8");
const section = readFileSync(new URL("../app/dashboard/section-page.tsx", import.meta.url), "utf8");

test("Google OAuth start is authenticated, workspace-bound and requests product-specific read-only scopes", () => {
  assert.match(connect, /auth\.getUser\(\)/);
  assert.match(connect, /workspace_members/);
  assert.match(connect, /createHmac\("sha256"/);
  assert.match(connect, /gmail\.readonly/);
  assert.match(connect, /spreadsheets\.readonly/);
  assert.match(connect, /access_type: "offline"/);
  assert.match(connect, /prompt: "consent select_account"/);
  assert.match(connect, /httpOnly: true/);
});

test("OAuth callback verifies state, workspace, membership and granted scope before encrypted persistence", () => {
  assert.match(callback, /timingSafeEqual/);
  assert.match(callback, /workspace_changed/);
  assert.match(callback, /workspace_members/);
  assert.match(callback, /token\.scope/);
  assert.match(callback, /encryptGoogleCredentials\(credentials\)/);
  assert.match(callback, /onConflict: "workspace_id,product"/);
  assert.doesNotMatch(callback, /console\.(log|error).*access_token/i);
});

test("Google connection metadata is workspace isolated and tokens are service-role only", () => {
  assert.match(migration, /create unique index if not exists google_connections_workspace_product_unique_idx/i);
  assert.match(migration, /on public\.google_connections\(workspace_id, product\)/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /private\.is_workspace_member\(workspace_id\)/);
  assert.match(migration, /revoke all on public\.google_connections from public, anon, authenticated/i);
  assert.match(migration, /grant all on public\.google_connections to service_role/i);
});

test("Integrations UI offers distinct Gmail and Sheets OAuth connections and honest status", () => {
  assert.match(ui, /Connect your Google account/);
  assert.match(ui, /connect\?product=/);
  assert.match(ui, /Not connected/);
  assert.match(ui, /Connected ·/);
  assert.match(section, /<GoogleOAuthConnections\/>/);
  assert.match(status, /Cache-Control.*private, no-store/);
});
