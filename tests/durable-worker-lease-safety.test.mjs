import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const worker = readFileSync(new URL("../lib/workflows/durable-worker.ts", import.meta.url), "utf8");
const safeHttp = readFileSync(new URL("../nodes/safe-http.ts", import.meta.url), "utf8");
const nodeTypes = readFileSync(new URL("../nodes/types.ts", import.meta.url), "utf8");

test("worker aborts provider execution when heartbeat or lease renewal fails", () => {
  assert.match(worker, /leaseState\.lost = true/);
  assert.match(worker, /leaseState\.controller\.abort\(new Error\("EXECUTION_LEASE_LOST"\)\)/);
  assert.match(worker, /heartbeat_execution_job/);
  assert.match(worker, /EXECUTION_LEASE_LOST/);
});

test("provider authorization renews the lease immediately before every registered operation", () => {
  assert.match(worker, /authorizeOperation: async[\s\S]*?heartbeat_execution_job[\s\S]*?getWorkerOperationMapping/);
  assert.match(worker, /executionContext\(credentials, job\.payload\?\.webhookVerified === true, db, job\.workspace_id, job, leaseState\)/);
});

test("safe HTTP requests are aborted when the worker lease signal is aborted", () => {
  assert.match(nodeTypes, /signal\?: AbortSignal/);
  assert.match(safeHttp, /signal\?: AbortSignal/);
  assert.match(safeHttp, /addEventListener\("abort"/);
  assert.match(safeHttp, /EXECUTION_LEASE_LOST/);
});
