import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(new URL("../scripts/staging-smoke.mjs", import.meta.url));

function runSmoke(url) {
  const env = { ...process.env };
  delete env.AIVANTA_STAGING_URL;
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
  const result = runSmoke("https://ai-automation-veerex-org.vercel.app");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to run smoke tests/);
});

test("staging smoke script refuses non-HTTPS targets", () => {
  const result = runSmoke("http://ai-automation-git-phase-12-preview-veerex-org.vercel.app");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /non-HTTPS/);
});

test("staging smoke script requires a hostname that identifies staging or preview", () => {
  const result = runSmoke("https://example.com");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /hostname must clearly identify a staging or preview/);
});
