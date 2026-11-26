import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("../app/api/workflows/[workflowId]/route.ts", import.meta.url), "utf8");

test("activation validates and atomically updates only the exact workflow version it inspected", () => {
  assert.match(route, /let activationVersion: number \| null = null/);
  assert.match(route, /activationVersion = candidate\.version/);
  assert.match(route, /\.eq\("version", activationVersion\)/);
  assert.match(route, /Playbook changed while activation checks are running/);
  assert.match(route, /status: 409/);
});

test("activation remains fail-closed on live execution, operation policy, test evidence, connections and approvals", () => {
  assert.match(route, /AIVANTA_LIVE_EXECUTION_ENABLED !== "true"/);
  assert.match(route, /validateDurableLiveSteps\(steps,\s*\{/);
  assert.match(route, /workflow_version", candidate\.version/);
  assert.match(route, /last_test_status/);
  assert.match(route, /workspace_provider_operation_approvals/);
  assert.match(route, /approval\.decision !== "approved"/);
});
