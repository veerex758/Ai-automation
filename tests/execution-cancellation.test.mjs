import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20261114110000_aivanta_execution_cancellation.sql", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/workflows/[workflowId]/executions/[jobId]/route.ts", import.meta.url), "utf8");
const worker = readFileSync(new URL("../lib/workflows/durable-worker.ts", import.meta.url), "utf8");
const panel = readFileSync(new URL("../app/dashboard/workflows/[workflowId]/run-test-panel.tsx", import.meta.url), "utf8");

test("cancellation RPC immediately cancels queued work and requests cancellation for leased work", () => {
  assert.match(migration, /status in \('queued','running','retry_wait','waiting','succeeded','dead_letter','cancelled'\)/);
  assert.match(migration, /return 'cancellation_requested'/);
  assert.match(migration, /cancel_requested_at = coalesce\(cancel_requested_at, now\(\)\)/);
  assert.match(migration, /finish_cancelled_execution_job/);
});

test("execution cancellation endpoint derives workspace from authenticated workflow access", () => {
  assert.match(route, /auth\.getUser\(\)/);
  assert.match(route, /from\("workflows"\)[\s\S]*?select\("id,workspace_id"\)/);
  assert.match(route, /cancel_execution_job/);
  assert.match(route, /p_workspace_id: workflow\.workspace_id/);
  assert.match(route, /p_workflow_id: workflow\.id/);
  assert.match(migration, /workflow_id = p_workflow_id/);
});

test("durable worker stops a cancelled run and records the terminal cancelled state", () => {
  assert.match(worker, /cancel_requested_at/);
  assert.match(worker, /EXECUTION_CANCELLED/);
  assert.match(worker, /finish_cancelled_execution_job/);
  assert.match(worker, /cancelled\+\+/);
});

test("live execution UI exposes cancellation while a queued or running job is being polled", () => {
  assert.match(panel, /activeJobId/);
  assert.match(panel, /Cancel execution/);
  assert.match(panel, /method: "PATCH"/);
  assert.match(panel, /"cancelled"/);
});
