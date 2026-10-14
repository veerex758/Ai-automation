import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const smokeScript = resolve(here, "staging-smoke.mjs");
const approvedPreview = "https://ai-automation-52awb5lpz-veerex-org.vercel.app";
const fakeBypassSecret = "test-only-not-a-real-secret";

function runGuardCheck(options) {
  const { url } = options;
  const secret = Object.hasOwn(options, "secret") ? options.secret : fakeBypassSecret;
  const env = { ...process.env };
  if (url === undefined) delete env.AIVANTA_STAGING_URL;
  else env.AIVANTA_STAGING_URL = url;
  if (secret === undefined) delete env.VERCEL_AUTOMATION_BYPASS_SECRET;
  else env.VERCEL_AUTOMATION_BYPASS_SECRET = secret;

  return spawnSync(process.execPath, [smokeScript], {
    env,
    encoding: "utf8",
    timeout: 5_000,
  });
}

test("staging smoke guardrails reject a missing URL before any request", () => {
  const result = runGuardCheck({ url: undefined });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Set AIVANTA_STAGING_URL/);
  assert.doesNotMatch(result.stdout, /Aivanta staging smoke test:/);
});

test("staging smoke guardrails reject non-HTTPS URLs before any request", () => {
  const result = runGuardCheck({ url: "http://staging.example.com" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /non-HTTPS environment/);
  assert.doesNotMatch(result.stdout, /Aivanta staging smoke test:/);
});

test("staging smoke guardrails reject the known production hostname", () => {
  const result = runGuardCheck({
    url: "https://ai-automation-veerex-org.vercel.app",
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to run smoke tests/);
  assert.doesNotMatch(result.stdout, /Aivanta staging smoke test:/);
});

test("staging smoke guardrails reject arbitrary domains with preview or git markers", () => {
  for (const url of [
    "https://example.com",
    "https://preview.example.com",
    "https://evil-git-preview.com",
    "https://ai-automation-git-phase-12.attacker.example",
  ]) {
    const result = runGuardCheck({ url });
    assert.equal(result.status, 2, url);
    assert.match(result.stderr, /this project's Vercel Git preview hostname/, url);
    assert.doesNotMatch(result.stdout, /Aivanta staging smoke test:/, url);
  }
});

test("staging smoke guardrails reject the production main Git alias", () => {
  const result = runGuardCheck({ url: "https://ai-automation-git-main-veerex-org.vercel.app" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to run smoke tests/);
  assert.doesNotMatch(result.stdout, /Aivanta staging smoke test:/);
});

test("staging smoke guardrails require the protection bypass secret", () => {
  const result = runGuardCheck({
    url: approvedPreview,
    secret: undefined,
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /VERCEL_AUTOMATION_BYPASS_SECRET/);
  assert.doesNotMatch(result.stdout, /Aivanta staging smoke test:/);
});
