import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(new URL("../scripts/staging-smoke.mjs", import.meta.url));

function runSmoke(url) {
  const env = { ...process.env };
  delete env.AIVANTA_STAGING_URL;
  delete env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (url !== undefined) env.AIVANTA_STAGING_URL = url;

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
    assert.match(result.stderr, /Refusing to run smoke tests/, url);
  }
});

test("staging smoke script refuses non-HTTPS targets", () => {
  const result = runSmoke("http://ai-automation-git-phase-12-veerex-org.vercel.app");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /non-HTTPS/);
});

test("staging smoke script refuses arbitrary domains containing preview or git markers", () => {
  for (const url of [
    "https://preview.example.com",
    "https://evil-git-preview.com",
    "https://ai-automation-git-phase-12.attacker.example",
  ]) {
    const result = runSmoke(url);
    assert.equal(result.status, 2, url);
    assert.match(result.stderr, /this project's Vercel Git preview hostname/, url);
  }
});

test("staging smoke script refuses unrecognized hostnames", () => {
  const result = runSmoke("https://example.com");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /this project's Vercel Git preview hostname/);
});

test("exact approved preview host passes host validation but still requires the bypass secret", () => {
  const result = runSmoke("https://ai-automation-52awb5lpz-veerex-org.vercel.app");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Set VERCEL_AUTOMATION_BYPASS_SECRET/);
  assert.doesNotMatch(result.stderr, /Refusing to run smoke tests/);
});
