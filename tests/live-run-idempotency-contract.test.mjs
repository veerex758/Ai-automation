import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const legacyRoute = readFileSync(
  new URL("../app/api/workflows/[workflowId]/live-run/route.ts", import.meta.url),
  "utf8",
);
const registryRoute = readFileSync(
  new URL("../app/api/workflows/[workflowId]/registry-run/route.ts", import.meta.url),
  "utf8",
);
const dispatchRoute = readFileSync(
  new URL("../app/api/workflows/[workflowId]/dispatch/route.ts", import.meta.url),
  "utf8",
);
const queueMigration = readFileSync(
  new URL("../supabase/migrations/20261031100000_aivanta_durable_execution_queue.sql", import.meta.url),
  "utf8",
);
const liveModeMigration = readFileSync(
  new URL("../supabase/migrations/20261102090000_aivanta_live_durable_execution_mode.sql", import.meta.url),
  "utf8",
);

test("legacy synchronous live-run endpoint rejects global-credential execution", () => {
  assert.match(legacyRoute, /DURABLE_DISPATCH_REQUIRED/);
  assert.doesNotMatch(legacyRoute, /executeLiveAction|sendResendEmail|RESEND_API_KEY/);
});

test("direct registry endpoint refuses live mode and requires durable dispatch", () => {
  assert.match(registryRoute, /DURABLE_DISPATCH_REQUIRED/);
  assert.match(registryRoute, /credentials: \{\}/);
});

test("durable dispatch requires a UUID idempotency key before queue creation", () => {
  assert.match(dispatchRoute, /request\.headers\.get\(["']idempotency-key["']\)/i);
  assert.match(dispatchRoute, /uuidPattern\.test\(idempotencyKey\)/);
  assert.match(dispatchRoute, /A UUID Idempotency-Key header is required/);
});

test("idempotency is scoped to a workspace and immutable workflow snapshot in the queue RPC", () => {
  assert.match(dispatchRoute, /p_workspace_id: workflow\.workspace_id/);
  assert.match(dispatchRoute, /p_workflow_id: workflow\.id/);
  assert.match(dispatchRoute, /p_idempotency_key: idempotencyKey/);
  assert.match(queueMigration, /unique \(workspace_id, idempotency_key\)/);
  assert.match(queueMigration, /pg_advisory_xact_lock/);
  assert.match(queueMigration, /workflow_row\.version, workflow_row\.definition/);
});

test("duplicate queue dispatch returns the existing run without creating another provider execution", () => {
  const rpcCall = dispatchRoute.indexOf('db.rpc("dispatch_workflow_execution"');
  const duplicateResponse = dispatchRoute.indexOf('result.duplicate ? "existing" : "queued"');
  const workerWakeup = dispatchRoute.indexOf("after(async () =>");
  assert.ok(rpcCall >= 0 && duplicateResponse > rpcCall);
  assert.ok(workerWakeup > duplicateResponse);
  assert.match(dispatchRoute.slice(duplicateResponse, workerWakeup), /duplicate: result\.duplicate/);
});

test("live jobs have one attempt and uncertain outcomes are not automatically replayed", () => {
  assert.match(dispatchRoute, /p_max_attempts: executionMode === "live" \? 1 : 5/);
  assert.match(liveModeMigration, /case when p_execution_mode = 'live' then 1 else p_max_attempts end/);
  assert.match(dispatchRoute, /queue remains the source of truth/);
  assert.doesNotMatch(legacyRoute, /retrySafe:\s*true/);
});
