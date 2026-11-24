import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("../app/api/integrations/workspace/resend/test-email/route.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/dashboard/connections/page.tsx", import.meta.url), "utf8");

test("Resend setup test email uses a fixed sender and the authenticated verified account email", () => {
  assert.match(route, /const TEST_SENDER = "onboarding@resend\.dev"/);
  assert.match(route, /const testRecipient = user\.email\.trim\(\)\.toLowerCase\(\)/);
  assert.match(route, /to: \[testRecipient\]/);
  assert.match(route, /email_confirmed_at/);
  assert.match(route, /const requestedConnectionId = typeof body\?\.connectionId === "string"/);
  assert.doesNotMatch(route, /const TEST_RECIPIENT/);
  assert.doesNotMatch(route, /to: \[body\./);
});

test("Resend test email requires an authenticated workspace owner or admin", () => {
  assert.match(route, /auth\.getUser\(\)/);
  assert.match(route, /workspace_members/);
  assert.match(route, /\["owner", "admin"\]/);
  assert.match(route, /decryptWorkspaceCredentials/);
});

test("Connections UI requires an explicit click to send the one-off test email", () => {
  assert.match(page, /Send test email/);
  assert.match(page, /\/api\/integrations\/workspace\/resend\/test-email/);
  assert.match(page, /sendingResendTest/);
});

test("Resend credential verification is distinct from sender-domain production readiness", () => {
  const connectionTest = readFileSync(new URL("../app/api/integrations/workspace/resend/test/route.ts", import.meta.url), "utf8");
  const integrationApi = readFileSync(new URL("../app/api/integrations/workspace/route.ts", import.meta.url), "utf8");
  const worker = readFileSync(new URL("../lib/workflows/durable-worker.ts", import.meta.url), "utf8");

  assert.match(connectionTest, /credentialCheck: "passed"/);
  assert.match(connectionTest, /productionReady: Boolean\(verified\)/);
  assert.match(connectionTest, /status: verified \? "connected" : "needs_attention"/);
  assert.match(connectionTest, /senderDomainVerified: Boolean\(verified\)/);
  assert.match(integrationApi, /last_test_status,updated_at,metadata/);
  assert.match(page, /API credentials valid/);
  assert.match(page, /domain verification required/);

  // The worker still requires status=connected, so a valid API key with an
  // unverified sender domain cannot be used for live workflow email.
  assert.match(worker, /\.eq\("status", "connected"\)\.eq\("last_test_status", "passed"\)/);
});
