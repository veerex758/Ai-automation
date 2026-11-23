import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const legacyRoute = readFileSync(new URL("../app/api/workflows/[workflowId]/live-run/route.ts", import.meta.url), "utf8");
const dispatch = readFileSync(new URL("../app/api/workflows/[workflowId]/dispatch/route.ts", import.meta.url), "utf8");
const worker = readFileSync(new URL("../lib/workflows/durable-worker.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20261031100000_aivanta_durable_execution_queue.sql", import.meta.url), "utf8");

test("legacy synchronous live-run endpoint rejects execution and requires durable dispatch", () => {
  assert.match(legacyRoute, /Synchronous live execution is disabled/);
  assert.match(legacyRoute, /DURABLE_DISPATCH_REQUIRED/);
  assert.match(legacyRoute, /statusCode: 409/);
  assert.doesNotMatch(legacyRoute, /safeRun|dispatch\(/);
  assert.match(dispatch, /dispatch_workflow_execution/);
});

test("durable dispatch requires a UUID idempotency key before queueing", () => {
  assert.match(dispatch, /request\.headers\.get\("idempotency-key"\)/);
  assert.match(dispatch, /if \(!uuidPattern\.test\(idempotencyKey\)\)/);
  assert.match(dispatch, /A UUID Idempotency-Key header is required/);
});

test("dispatch sends workspace, workflow, actor, version and idempotency key to the atomic queue RPC", () => {
  assert.match(dispatch, /dispatch_workflow_execution/);
  assert.match(dispatch, /p_workspace_id: workflow\.workspace_id/);
  assert.match(dispatch, /p_workflow_id: workflow\.id/);
  assert.match(dispatch, /p_workflow_version: workflow\.version/);
  assert.match(dispatch, /p_created_by: user\.id/);
  assert.match(dispatch, /p_idempotency_key: idempotencyKey/);
});

test("database queue enforces workspace-scoped idempotency and bounded payloads", () => {
  assert.match(migration, /unique \(workspace_id, idempotency_key\)/);
  assert.match(migration, /octet_length\(p_payload::text\) > 16384/);
  assert.match(migration, /Execution job ownership or version mismatch/);
});

test("queue dispatch is committed before the worker is woken", () => {
  const rpc = dispatch.indexOf('db.rpc("dispatch_workflow_execution"');
  const wake = dispatch.indexOf("after(async () =>", rpc);
  assert.ok(rpc >= 0 && wake > rpc);
  assert.match(dispatch.slice(rpc, wake), /p_execution_mode: executionMode/);
});

test("durable worker uses lease tokens and records retry-safe failures", () => {
  assert.match(worker, /lease_token/);
  assert.match(worker, /record_execution_error_event/);
  assert.match(worker, /retry_wait/);
  assert.match(migration, /create table if not exists public\.execution_dead_letters/);
  assert.match(migration, /insert into public\.execution_dead_letters/);
});
