import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const catalogSource = readFileSync("nodes/provider-catalog.ts", "utf8");
const directorySource = readFileSync("app/dashboard/registry-integrations-directory.tsx", "utf8");
const credentialsSource = readFileSync("lib/integrations/workspace-credentials.ts", "utf8");
const connectionsSource = readFileSync("app/dashboard/connections/page.tsx", "utf8");
const connectionTestSource = readFileSync("app/api/integrations/workspace/test/route.ts", "utf8");
const workerSource = readFileSync("lib/workflows/durable-worker.ts", "utf8");
const resendTestSource = readFileSync("app/api/integrations/workspace/resend/test/route.ts", "utf8");

test("all 100 directory entries have official brand artwork or an explicit native icon path", () => {
  const ids = [...catalogSource.matchAll(/"id": "([^"]+)"/g)].map((match) => match[1]);
  const assetsBlock = directorySource.match(/const officialBrandAssets:[\s\S]*?= (\{[\s\S]*?\});\nconst googleProductForNode/);
  assert.ok(assetsBlock, "official brand asset map must remain machine-readable");
  const assets = JSON.parse(assetsBlock[1]);
  const native = new Set([
    "webhook_trigger", "schedule_cron", "manual_trigger", "http_request", "if", "switch", "loop",
    "merge", "wait_delay", "code_js", "set_fields", "json_parse", "filter", "aggregate", "date_time",
  ]);
  assert.equal(ids.length, 100);
  assert.equal(new Set(ids).size, 100);
  assert.deepEqual(ids.filter((id) => !assets[id] && !native.has(id)), []);
});

test("every workspace credential provider has a connection form", () => {
  const providerUnion = credentialsSource.match(/export type WorkspaceCredentialProvider =([\s\S]*?);/);
  assert.ok(providerUnion);
  const providers = [...providerUnion[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  const formKeys = [...connectionsSource.matchAll(/^\s{2}([a-z0-9_]+): \{ label:/gm)].map((match) => match[1]);
  assert.equal(new Set(formKeys).size, formKeys.length);
  assert.deepEqual(providers.filter((provider) => !formKeys.includes(provider)), []);
});

test("new provider-pack connection checks remain read-only and fail closed when no safe check exists", () => {
  for (const provider of ["claude", "http", "mistral", "groq", "discord", "telegram", "whatsapp_business", "sendgrid", "mailgun", "postmark", "github", "gitlab", "sentry", "vercel", "calendly", "zendesk", "freshdesk", "serpapi", "openweather"]) {
    assert.match(connectionTestSource, new RegExp('case "' + provider + '":'));
    assert.match(connectionTestSource, new RegExp('"' + provider + '"'));
  }
  assert.match(connectionTestSource, /Perplexity does not expose a safe read-only credential check/);
});

test("durable live execution requires both a connected integration and a passed credential test", () => {
  assert.match(workerSource, /select\("id,status,last_test_status"\)/);
  assert.match(workerSource, /integration\.status !== "connected" \|\| integration\.last_test_status !== "passed"/);
  assert.match(directorySource, /record\.last_test_status === "passed"/);
  assert.match(directorySource, /liveExecutionEnabled && liveProvidersEnabled\.includes\(providerPermissionKey\)/);
  assert.match(directorySource, /state === "connected" && livePermissionEnabled/);
});

test("every credential provider has a non-destructive verification path or an explicit safe exception", () => {
  const providerUnion = credentialsSource.match(/export type WorkspaceCredentialProvider =([\s\S]*?);/);
  assert.ok(providerUnion);
  const providers = [...providerUnion[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  const testableBlock = connectionTestSource.match(/const TESTABLE = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(testableBlock);
  const testable = [...testableBlock[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(providers.filter((provider) => !testable.includes(provider)), ["resend"]);
  assert.match(resendTestSource, /last_test_status: "passed"/);
  assert.match(connectionTestSource, /Perplexity does not expose a safe read-only credential check/);
});
