import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const credentials = readFileSync(new URL("../lib/integrations/google-credentials.ts", import.meta.url), "utf8");
const runtime = readFileSync(new URL("../lib/integrations/workspace-credentials.ts", import.meta.url), "utf8");
const registry = readFileSync(new URL("../nodes/registry.ts", import.meta.url), "utf8");
const gmail = readFileSync(new URL("../nodes/gmail.ts", import.meta.url), "utf8");
const sheets = readFileSync(new URL("../nodes/google-sheets.ts", import.meta.url), "utf8");

test("Google tokens use authenticated encryption and can reuse the Aivanta credential key", () => {
  assert.match(credentials, /createCipheriv\("aes-256-gcm"/);
  assert.match(credentials, /createDecipheriv\("aes-256-gcm"/);
  assert.match(credentials, /GOOGLE_TOKEN_ENCRYPTION_KEY \?\? process\.env\.AIVANTA_CREDENTIALS_ENCRYPTION_KEY/);
});

test("workspace token loader enforces read-only scopes and refreshes expiring tokens server-side", () => {
  assert.match(runtime, /google_connections/);
  assert.match(runtime, /gmail\.readonly/);
  assert.match(runtime, /spreadsheets\.readonly/);
  assert.match(runtime, /oauth2\.googleapis\.com\/token/);
  assert.match(runtime, /grant_type: "refresh_token"/);
  assert.match(runtime, /status: "needs_reauth"/);
  assert.match(runtime, /encrypted_credentials: encryptGoogleCredentials\(stored\)/);
});

test("Gmail and Sheets nodes are registered with read-only OAuth scopes", () => {
  assert.match(registry, /gmailNode/);
  assert.match(registry, /googleSheetsNode/);
  assert.match(gmail, /gmail\.readonly/);
  assert.match(gmail, /list_messages/);
  assert.match(gmail, /read_message/);
  assert.match(sheets, /spreadsheets\.readonly/);
  assert.match(sheets, /read_range/);
  assert.doesNotMatch(gmail, /messages\.send/);
  assert.doesNotMatch(sheets, /:batchUpdate|values:batchUpdate/);
});
