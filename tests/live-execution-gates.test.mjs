import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const durableWorker = await readFile(new URL("../lib/workflows/durable-worker.ts", import.meta.url), "utf8");
const registryRoute = await readFile(new URL("../app/api/workflows/[workflowId]/registry-run/route.ts", import.meta.url), "utf8");
const workerOperationMap = await readFile(new URL("../lib/workflows/worker-operation-map.ts", import.meta.url), "utf8");

const utilityActions = [
  "deduplicate.unique", "sort.sort_items", "split_batches.split", "crypto_hash.hash",
  "template.render", "csv_parse.parse", "csv_stringify.stringify", "markdown_html.convert",
  "text_transform.transform", "regex.match", "array_ops.operate", "object_ops.operate",
  "math.calculate", "uuid.generate", "base64.convert", "date_add.add", "date_format.format",
  "rate_limiter.check", "json_encode.encode",
];

test("durable live execution resolves providers from the complete registry operation map", () => {
  assert.match(durableWorker, /getWorkerOperationMapping, getWorkerProvider/);
  assert.match(durableWorker, /return providerPackLiveId\(step\) \?\? getWorkerProvider\(step\)/);
  assert.match(workerOperationMap, /entries\.map/);
  assert.match(durableWorker, /return isProviderLiveEnabled\(provider, process\.env\.AIVANTA_LIVE_INTEGRATIONS\)/);
  assert.match(durableWorker, /WORKSPACE_PROVIDER_OPERATION_NOT_APPROVED/);
  assert.match(durableWorker, /AIVANTA_LIVE_VOICE_RECIPIENTS/);
  assert.match(durableWorker, /AIVANTA_LIVE_PUBLISHING_ENABLED/);
  assert.match(durableWorker, /LIVE_PUBLISHING_NOT_ENABLED/);
  assert.match(durableWorker, /LIVE_VOICE_RECIPIENT_NOT_ALLOWED/);
  assert.ok(durableWorker.includes("if (!/^\\+[1-9]\\d{7,14}$/.test(to)"), "SMS and voice recipients must use strict E.164 validation");
  assert.doesNotMatch(durableWorker, /const SERVER_ENABLED_INTEGRATIONS/);
});

test("all deterministic utility actions remain explicitly allowed through durable execution", () => {
  const start = durableWorker.indexOf("new Set([", durableWorker.indexOf("function liveStepAllowed"));
  const end = durableWorker.indexOf("]).has(step.nodeId + \".\" + step.operationId)", start);
  assert.ok(start >= 0 && end > start, "durable utility allowlist must be present");
  const allowlist = durableWorker.slice(start, end);
  for (const action of utilityActions) {
    const [nodeId, operationId] = action.split(".");
    assert.ok(allowlist.includes("\"" + nodeId + "." + operationId + "\""), action + " must remain live-safe");
  }
});

test("synchronous registry route keeps live execution restricted to allowlisted email actions", () => {
  assert.ok(registryRoute.includes("const unsupportedLiveStep = steps.find("));
  assert.ok(registryRoute.includes('step.nodeId === "manual" && step.operationId === "start"'));
  assert.ok(registryRoute.includes('step.nodeId === "email" && step.operationId === "send_email"'));
  assert.match(registryRoute, /AIVANTA_LIVE_EMAIL_RECIPIENTS/);
  assert.ok(registryRoute.includes("allowed.has(to)"));
  assert.match(registryRoute, /AIVANTA_LIVE_EXECUTION_ENABLED/);
});
