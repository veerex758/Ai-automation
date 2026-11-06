import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const durableWorker = await readFile(new URL("../lib/workflows/durable-worker.ts", import.meta.url), "utf8");
const registryRoute = await readFile(new URL("../app/api/workflows/[workflowId]/registry-run/route.ts", import.meta.url), "utf8");

const utilityActions = [
  "deduplicate.unique", "sort.sort_items", "split_batches.split", "crypto_hash.hash",
  "template.render", "csv_parse.parse", "csv_stringify.stringify", "markdown_html.convert",
  "text_transform.transform", "regex.match", "array_ops.operate", "object_ops.operate",
  "math.calculate", "uuid.generate", "base64.convert", "date_add.add", "date_format.format",
  "rate_limiter.check", "json_encode.encode",
];

test("durable live execution explicitly opts in every mapped external provider", () => {
  assert.match(durableWorker, /return isProviderLiveEnabled\(provider, process\.env\.AIVANTA_LIVE_INTEGRATIONS\);/);
  assert.doesNotMatch(durableWorker, /const SERVER_ENABLED_INTEGRATIONS/);
  assert.match(durableWorker, /if \(!provider\) return false;/);
  assert.match(durableWorker, /return false;\s*}/);
  for (const provider of ["openai", "gemini", "slack", "resend", "supabase", "postgresql", "redis", "firebase"]) {
    assert.match(durableWorker, new RegExp('step\\.nodeId === "' + provider + '"'));
  }
});

test("all 19 deterministic utility actions are allowed through durable execution", () => {
  const start = durableWorker.indexOf('new Set([', durableWorker.indexOf("function liveStepAllowed"));
  const end = durableWorker.indexOf("]).has(step.nodeId + \".\" + step.operationId)", start);
  assert.ok(start >= 0 && end > start, "durable utility allowlist must be present");
  const allowlist = durableWorker.slice(start, end);
  for (const action of utilityActions) {
    const [nodeId, operationId] = action.split(".");
    assert.ok(allowlist.includes('"' + nodeId + "." + operationId + '"'), action + " must be live-safe");
  }
});

test("synchronous registry route permits pure utilities but keeps external effects guarded", () => {
  const start = registryRoute.indexOf("const safeInternalActions = new Set(");
  const end = registryRoute.indexOf(");", start);
  assert.ok(start >= 0 && end > start);
  const allowlist = registryRoute.slice(start, end);
  for (const action of utilityActions.filter((item) => item !== "rate_limiter.check")) {
    assert.ok(allowlist.includes('"' + action + '"'), action + " must be safe in registry-run");
  }
  assert.match(registryRoute, /AIVANTA_LIVE_EMAIL_RECIPIENTS/);
  assert.match(registryRoute, /unsupportedLiveStep/);
  assert.doesNotMatch(allowlist, /openai|gemini|slack|supabase|postgresql|redis|firebase/);
});
