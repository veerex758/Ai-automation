import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("../app/api/integrations/workspace/resend/test-email/route.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/dashboard/connections/page.tsx", import.meta.url), "utf8");

test("Resend setup test email is fixed to the approved test sender and recipient", () => {
  assert.match(route, /const TEST_SENDER = "onboarding@resend\.dev"/);
  assert.match(route, /const TEST_RECIPIENT = "sundayezekielm069@gmail\.com"/);
  assert.match(route, /from: TEST_SENDER/);
  assert.match(route, /to: \[TEST_RECIPIENT\]/);
  assert.doesNotMatch(route, /request\.json\(\)/);
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
