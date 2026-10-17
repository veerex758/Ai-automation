import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(new URL("../scripts/staging-smoke.mjs", import.meta.url));
const approvedPreview = "https://ai-automation-git-fix-staging-smoke-preview-target-veerex-org.vercel.app";

function runSmoke(url, { secret } = {}) {
  const env = { ...process.env };
  delete env.AIVANTA_STAGING_URL;
  delete env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (url !== undefined) env.AIVANTA_STAGING_URL = url;
  if (secret !== undefined) env.VERCEL_AUTOMATION_BYPASS_SECRET = secret;

  return spawnSync(process.execPath, [scriptPath], {
    env,
    encoding: "utf8",
    timeout: 5000,
  });
}

test("staging smoke script requires an explicit target URL", () => {
  const result = runSmoke();
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Set AIVANTA_STAGING_URL/);
});

test("staging smoke script refuses known production aliases", () => {
  for (const url of [
    "https://ai-automation-veerex-org.vercel.app",
    "https://ai-automation-git-main-veerex-org.vercel.app",
  ]) {
    const result = runSmoke(url);
    assert.equal(result.status, 2, url);
    assert.match(result.stderr, /explicitly approved Aivanta preview hostname/, url);
  }
});

test("staging smoke script refuses arbitrary domains with preview or git markers", () => {
  for (const url of [
    "https://example.com",
    "https://preview.example.com",
    "https://evil-git-preview.com",
    "https://ai-automation-git-phase-12.attacker.example",
  ]) {
    const result = runSmoke(url);
    assert.equal(result.status, 2, url);
    assert.match(result.stderr, /explicitly approved Aivanta preview hostname/, url);
  }
});

test("staging smoke script refuses non-HTTPS targets before any request", () => {
  const result = runSmoke("http://ai-automation-git-fix-staging-smoke-preview-target-veerex-org.vercel.app");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /non-HTTPS/);
});

test("staging smoke script refuses URL credentials and non-default ports", () => {
  for (const url of [
    "https://user:password@ai-automation-git-fix-staging-smoke-preview-target-veerex-org.vercel.app",
    "https://ai-automation-git-fix-staging-smoke-preview-target-veerex-org.vercel.app:8443",
  ]) {
    const result = runSmoke(url);
    assert.equal(result.status, 2, url);
    assert.match(result.stderr, /explicitly approved Aivanta preview hostname/, url);
  }
});

test("approved preview hostname still requires the Vercel protection secret before requests", () => {
  const result = runSmoke(approvedPreview);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Set VERCEL_AUTOMATION_BYPASS_SECRET/);
  assert.doesNotMatch(result.stdout, /Aivanta staging smoke test:/);
});
