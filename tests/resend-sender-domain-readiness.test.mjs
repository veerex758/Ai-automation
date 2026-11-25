import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const route = read("../app/api/integrations/workspace/route.ts");
const page = read("../app/dashboard/connections/page.tsx");
const resendTest = read("../app/api/integrations/workspace/resend/test/route.ts");

test("workspace integration list returns only the safe sender readiness metadata", () => {
  assert.match(route, /select\("id,provider,status,display_name,last_tested_at,last_test_status,updated_at,metadata"\)/);
  assert.match(resendTest, /senderDomainStatus/);
  assert.match(resendTest, /credentialCheck: "passed"/);
  assert.doesNotMatch(resendTest, /apiKey\s*:/);
});

test("Resend UI separates valid API credentials from unverified sender-domain readiness", () => {
  assert.match(page, /credentialCheck\?: string/);
  assert.match(page, /API credentials valid · sender domain verified/);
  assert.match(page, /API credentials valid · sender domain/);
  assert.match(page, /domain verification required/);
  assert.match(page, /senderDomainStatus/);
});
