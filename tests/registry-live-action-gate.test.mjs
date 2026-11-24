import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const dispatchUrl = new URL("../app/api/workflows/[workflowId]/dispatch/route.ts", import.meta.url);
const workerUrl = new URL("../lib/workflows/durable-worker.ts", import.meta.url);

test("live registry execution is gated by durable provider policy and workspace approvals", async () => {
  const dispatch = await readFile(dispatchUrl, "utf8");
  const worker = await readFile(workerUrl, "utf8");
  assert.match(dispatch, /validateDurableLiveSteps\(registrySteps\)/);
  assert.match(worker, /WORKSPACE_PROVIDER_OPERATION_NOT_APPROVED/);
  assert.match(worker, /function liveStepAllowed/);
  assert.match(worker, /isProviderLiveEnabled\(provider, process\.env\.AIVANTA_LIVE_INTEGRATIONS\)/);
});

test("unapproved OpenAI, Slack and webhook operations cannot bypass provider opt-in", async () => {
  const worker = await readFile(workerUrl, "utf8");
  const gate = worker.slice(worker.indexOf("function liveStepAllowed"), worker.indexOf("export function validateDurableLiveSteps"));
  assert.match(gate, /step\.nodeId === "webhooks".*AIVANTA_DURABLE_WEBHOOK_LIVE_ENABLED/s);
  assert.doesNotMatch(gate, /nodeId === "(openai|slack)"[^\n]*return true/);
});
