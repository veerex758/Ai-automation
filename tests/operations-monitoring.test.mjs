import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const migration=await readFile(new URL("../supabase/migrations/20261114130000_aivanta_dashboard_usage_hardening.sql",import.meta.url),"utf8");
const worker=await readFile(new URL("../lib/workflows/durable-worker.ts",import.meta.url),"utf8");
const route=await readFile(new URL("../app/api/operations/route.ts",import.meta.url),"utf8");
const page=await readFile(new URL("../app/dashboard/operations/page.tsx",import.meta.url),"utf8");
test("worker heartbeats are server owned and service role only",()=>{
 assert.match(migration,/execution_worker_heartbeats/);assert.match(migration,/record_execution_worker_heartbeat/);
 assert.match(worker,/record_execution_worker_heartbeat/);
});
test("operations endpoint requires granular workspace operations permission and returns queue and worker telemetry",()=>{
 assert.match(route,/auth\.getUser\(\)/);assert.match(route,/hasWorkspacePermission/);assert.match(route,/"operations.view"/);
 assert.match(route,/execution_jobs/);assert.match(route,/execution_dead_letters/);assert.match(route,/execution_worker_heartbeats/);
});
test("operations page displays worker, queue, dead-letter and provider diagnostics",()=>{
 assert.match(page,/Worker health/);assert.match(page,/Dead-letter queue/);assert.match(page,/Provider diagnostics/);assert.match(page,/Recent execution jobs/);
});
