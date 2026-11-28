import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const page = await readFile(new URL("../app/dashboard/playbooks/new/page.tsx", import.meta.url), "utf8");
const route = await readFile(new URL("../app/api/ai/generate-workflow/route.ts", import.meta.url), "utf8");

test("Playbook generation offers retry only for known transient provider failures", () => {
  assert.match(page, /RETRYABLE_GATEWAY_ERRORS/);
  for (const code of [
    "AI_PROVIDER_OVERLOADED",
    "AI_RATE_LIMITED",
    "AI_PROVIDER_COOLDOWN",
    "AI_PROVIDER_CIRCUIT_UNAVAILABLE",
    "AI_TIMEOUT",
    "AI_PROVIDER_UNAVAILABLE",
  ]) {
    assert.match(page, new RegExp('"'+code+'"'));
  }
  assert.match(page, /if \(RETRYABLE_GATEWAY_ERRORS\.has\(errorCode\)\)/);
  assert.doesNotMatch(page, /RETRYABLE_GATEWAY_ERRORS\.has\(errorCode\).*response\.status\s*>=\s*500/s);
});

test("Playbook retry is explicit and reuses the exact prompt and CRM captured by the failed request", () => {
  assert.match(page, /type RetryRequest = \{/);
  assert.match(page, /prompt,\s*crmProvider: selectedCrmProvider/);
  assert.match(page, /onClick=\{\(\) => void generateDraft\(retryRequest\.prompt, retryRequest\.crmProvider\)\}/);
  assert.match(page, /type="button"[^>]*onClick=/);
  assert.match(page, /Retry AI generation/);
  assert.match(page, /disabled=\{generating\}/);
});

test("provider Retry-After is surfaced to the Playbook retry UI", () => {
  assert.match(page, /response\.headers\.get\("Retry-After"\)/);
  assert.match(page, /retryAfterSeconds/);
  assert.match(route, /"retryAfterMs" in error/);
  assert.match(route, /response\.headers\.set\("Retry-After"/);
});

test("retry feedback does not bypass draft-only save and activation boundaries", () => {
  assert.match(page, /status: "draft"/);
  assert.match(page, /Save Playbook draft/);
  assert.doesNotMatch(page, /\/api\/workflows\/[^"]+\/activate/);
  assert.doesNotMatch(page, /\/api\/workflows\/live-run/);
});
