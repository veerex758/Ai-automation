import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const page = await readFile(new URL("../app/dashboard/connections/page.tsx", import.meta.url), "utf8");
const api = await readFile(new URL("../app/api/integrations/workspace/route.ts", import.meta.url), "utf8");

test("connections UI displays persisted connection and test readiness states", () => {
  assert.match(page, /Connected accounts/);
  assert.match(page, /connection\.status/);
  assert.match(page, /needs_attention/);
  assert.match(page, /needs_reauth/);
  assert.match(api, /last_test_status/);
  assert.match(api, /last_tested_at/);
});

test("connections UI does not request or render secret credential fields", () => {
  assert.match(page, /Tokens never reach the browser/);
  assert.doesNotMatch(page, /encrypted_credentials/);
  assert.doesNotMatch(page, /refreshToken/);
});
