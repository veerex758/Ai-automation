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

test("durable live execution explicitly opts in every mapped external provider", () => {
  assert.match(durableWorker, /MAX_LIVE_ACTION_STEPS = 30/);
  assert.match(durableWorker, /length > MAX_LIVE_ACTION_STEPS/);
  assert.ok(durableWorker.includes("return isProviderLiveEnabled(provider, process.env.AIVANTA_LIVE_INTEGRATIONS);"));
  assert.match(durableWorker, /AIVANTA_LIVE_VOICE_RECIPIENTS/);
  assert.match(durableWorker, /AIVANTA_LIVE_PUBLISHING_ENABLED/);
  assert.match(durableWorker, /LIVE_PUBLISHING_NOT_ENABLED/);
  assert.match(durableWorker, /"x_twitter", "facebook_pages"¶»§q«^