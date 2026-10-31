import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/20261031100000_aivanta_durable_execution_queue.sql", import.meta.url),
  "utf8",
);
const worker = readFileSync(new URL("../app/api/internal/worker/route.ts", import.meta.url), "utf8");
const dispatch = readFileSync(new URL("../app/api/workflows/[workflowId]/dispatch/route.ts", import.meta.url), "utf8");

test("queue enforces workspace-scoped idempotent dispatch and bounded payloads", () => {
  assert.match(migration, /unique \(workspace_id, idempotency_key\)/);
  assert.match(migration, /octet_length\(p_payload::text\) > 16384/);
  assert.match(migration, /Execution job ownership or version mismatch/);
});

test("worker claims are atomic and reclaim expired leases", () => {
  assert.match(migration, /for update skip locked/i);
  assert.match(migration, /j\.lease_until < now\(\)/);
  assert.match(migration, /lease_token = gen_random_uuid\(\)/);
  assert.match(migration, /status = 'running', attempts = j\.attempts \+ 1/);
});

test("a worker that disappears on its final attempt is dead-lettered", () => {
  assert.match(migration, /j\.attempts >= j\.max_attempts/);
  assert.match(migration, /WORKER_LEASE_EXHAUSTED/);
  assert.match(migration, /insert into public\.execution_dead_letters/i);
});

test("checkpoints are unique per job step and lease protected", () => {
  assert.match(migration, /unique \(job_id, step_id\)/);
  assert.match(migration, /p_lease_token/);
  assert.match(migration, /Execution lease lost/);
});

test("retry backoff is bounded and terminal failures are copied to dead letters", () => {
  assert.match(migration, /status='retry_wait'/);
  assert.match(migration, /least\(3600/);
  assert.match(migration, /status='dead_letter'/);
});

test("queue tables and RPCs are not exposed to browser roles", () => {
  assert.match(migration, /revoke all on public\.execution_jobs, public\.execution_checkpoints, public\.execution_dead_letters from public, anon, authenticated/i);
  assert.match(migration, /grant all on public\.execution_jobs, public\.execution_checkpoints, public\.execution_dead_letters to service_role/i);
});

test("worker authenticates with a server secret and only executes side-effect-free dry-runs", () => {
  assert.match(worker, /timingSafeEqual/);
  assert.match(worker, /claim_execution_jobs/);
  assert.match(worker, /sideEffectsPerformed !== false/);
  assert.doesNotMatch(worker, /sendResendEmail|fetch\(/);
});

test("dispatch requires an authenticated user and an idempotency key", () => {
  assert.match(dispatch, /auth\.getUser\(\)/);
  assert.match(dispatch, /idempotency-key/i);
  assert.match(dispatch, /dispatch_workflow_execution/);
  assert.doesNotMatch(dispatch, /from\("workflow_runs"\)\.insert/);
  assert.match(dispatch, /result\.duplicate \? "existing" : "queued"/);
});

test("dispatch creates the run and queue row in one serialized transaction", () => {
  assert.match(migration, /create or replace function public\.dispatch_workflow_execution/i);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /return jsonb_build_object\('job_id', new_job_id, 'run_id', new_run_id, 'duplicate', false\)/);
  assert.match(migration, /unique \(workspace_id, idempotency_key\)/);
});

test("run finalization is lease-checked and committed with job success", () => {
  assert.match(migration, /select \* into job_row[\s\S]*?lease_token = p_lease_token and lease_until > now\(\)[\s\S]*?for update/i);
  assert.match(migration, /update public\.workflow_runs set status='succeeded'/);
  assert.doesNotMatch(worker, /from\("workflow_runs"\)\.update/);
});


test("dispatch snapshots the exact workflow version for immutable queued execution", () => {
  assert.match(migration, /workflow_version integer not null/);
  assert.match(migration, /workflow_definition jsonb not null/);
  assert.match(migration, /select w\.\* into workflow_row[\s\S]*?for share/i);
  assert.match(migration, /workflow_row\.version, workflow_row\.definition/);
  assert.match(worker, /validateDefinition\(definition\)/);
  assert.doesNotMatch(worker, /from\("workflows"\)/);
});


test("legacy enqueue RPC also writes the immutable workflow snapshot", () => {
  assert.match(migration, /insert into public\.execution_jobs\s*\(workspace_id, workflow_id, run_id, workflow_version, workflow_definition, idempotency_key, payload, max_attempts\)/);
  assert.match(migration, /run_row\.workflow_version, workflow_row\.definition/);
});


test("durable worker supports registry definitions without network or provider side effects", async () => {
  const worker = readFileSync(new URL("../app/api/internal/worker/route.ts", import.meta.url), "utf8");
  assert.match(worker, /executeRegisteredWorkflow\(\{ steps, context, dryRun: true \}\)/);
  assert.match(worker, /DRY_RUN_NETWORK_BLOCKED/);
  assert.match(worker, /webhook: \{ verified: job\.payload\?\.webhookVerified === true \}/);
  assert.match(worker, /status: step\.status === "succeeded" \? "simulated" : step\.status/);
  assert.doesNotMatch(worker, /AIVANTA_LIVE_EXECUTION_ENABLED/);
});
