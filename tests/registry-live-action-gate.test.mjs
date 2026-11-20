import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const routeUrl = new URL("../app/api/workflows/[workflowId]/registry-run/route.ts", import.meta.url);

test("legacy synchronous registry route rejects every live execution", async () => {
  const source = await readFile(routeUrl, "utf8");
  assert.match(source, /DURABLE_DISPATCH_REQUIRED/);
  assert.match(source, /dryRun: true/);
  assert.match(source, /credentials: \{\}/);
  assert.doesNotMatch(source, /GEMINI_API_KEY|RESEND_API_KEY|SLACK_INCOMING_WEBHOOK_URL/);
});

test("registered live workflow execution is delegated to the durable worker", async () => {
  const source = await readFile(routeUrl, "utf8");
  const worker = await readFile(new URL("../lib/workflows/durable-worker.ts", import.meta.url), "utf8");
  assert.match(worker, /context\.resolveStepCredentials = async/);
  assert.match(worker, /workspaceCredentials\(/);
  assert.match(worker, /WORKSPACE_PROVIDER_OPERATION_NOT_APPROVED/);
  assert.match(worker, /AIVANTA_LIVE_INTEGRATIONS/);
});
