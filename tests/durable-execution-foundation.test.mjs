import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/20261031100000_aivanta_durable_execution_queue.sql", import.meta.url),
  "utf8",
);
const worker = readFileSync(new URL("../app/api/internal/worker/route.ts", import.meta.url), "utf8");
const workerService = readFileSync(new URL("../lib/workflows/durable-worker.ts", import.meta.url), "utf8");
const dispatch = readFileSync(new URL("../app/api/workflows/[workflowId]/dispatch/route.ts", import.meta.url), "utf8");
const liveModeMigration = readFileSync(new URL("../supabase/migrations/20261102090000_aivanta_live_durable_execution_mode.sql", import.meta.url), "utf8");
const utilityMigration = readFileSync(new URL("../supabase/migrations/20261105045346_aivanta_utility_execution_hardening.sql", import.meta.url), "utf8");
const utilityIndexesMigration = readFileSync(new URL("../supabase/migrations/20261105045900_aivanta_utility_execution_indexes.sql", import.meta.url), "utf8");
const runPanel = readFileSync(new URL("../app/dashboard/workflows/[workflowId]/run-test-panel.tsx", import.meta.url), "utf8");

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

test("worker endpoint authenticates requests and legacy previews remain side-effect free", () => {
  assert.match(worker, /timingSafeEqual/);
  assert.match(workerService, /claim_execution_jobs/);
  assert.match(workerService, /sideEffectsPerformed !== false/);
  assert.match(workerService, /LIVE_LEGACY_OPERATION_NOT_ENABLED/);
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
  assert.match(workerService, /validateDefinition\(definition\)/);
  assert.doesNotMatch(worker, /from\("workflows"\)/);
});


test("legacy enqueue RPC also writes the immutable workflow snapshot", () => {
  assert.match(migration, /insert into public\.execution_jobs\s*\(workspace_id, workflow_id, run_id, workflow_version, workflow_definition, idempotency_key, payload, max_attempts\)/);
  assert.match(migration, /run_row\.workflow_version, workflow_row\.definition/);
});


test("durable worker executes registered steps only for explicitly gated live jobs", () => {
  assert.match(workerService, /executeRegisteredWorkflow\(/);
  assert.match(workerService, /AIVANTA_LIVE_EXECUTION_ENABLED !== "true"/);
  assert.match(workerService, /workspaceCredentials\(db, job\.workspace_id, requiredProviders, marketplaceConnectionMap\)/);
  assert.match(workerService, /onStepStart/);
  assert.match(workerService, /onStepComplete/);
  assert.match(workerService, /LIVE_OPERATION_NOT_ENABLED/);
  assert.match(workerService, /LIVE_DURABLE_WEBHOOK_NOT_ENABLED/);
  assert.match(workerService, /p_limit: 1/);
  assert.match(workerService, /length > MAX_LIVE_ACTION_STEPS/);
  assert.match(workerService, /MAX_LIVE_ACTION_STEPS = 30/);
});


test("workflow run panel dispatches live runs through the durable queue and polls status", () => {
  assert.match(runPanel, /\/dispatch/);
  assert.match(runPanel, /mode: "live"/);
  assert.match(runPanel, /\/executions\/\$\{jobId\}/);
  assert.match(runPanel, /idempotencyKey\.current/);
});

test("dispatch validates registered definitions and guards legacy live email", () => {
  assert.match(dispatch, /isRegistryDefinition/);
  assert.match(dispatch, /findOperation/);
  assert.match(dispatch, /validateDurableLiveSteps/);
  assert.match(workerService, /export function validateDurableLiveSteps/);
  assert.match(workerService, /LIVE_PUBLISHING_NOT_ENABLED/);
  assert.match(workerService, /LIVE_VOICE_RECIPIENT_NOT_ALLOWED/);
  assert.doesNotMatch(dispatch, /isLiveRegistryOperationAllowed/);
  assert.doesNotMatch(dispatch, /length > 4/);
  assert.match(dispatch, /AIVANTA_LIVE_EMAIL_RECIPIENTS/);
  assert.match(dispatch, /Durable legacy live execution currently supports one manual-trigger Resend email action/);
});

test("authenticated dispatch wakes the server-side durable worker after queuing", () => {
  assert.match(dispatch, /after\(async \(\) =>/);
  assert.match(dispatch, /runDurableWorker\(\)/);
  assert.match(dispatch, /queue remains the source of truth/);
});

test("live queue dispatch is explicit and limited to one attempt", () => {
  assert.match(liveModeMigration, /execution_mode text not null default 'dry_run'/);
  assert.match(liveModeMigration, /case when p_execution_mode = 'live' then 1 else p_max_attempts end/);
  assert.match(liveModeMigration, /p_execution_mode/);
  assert.match(liveModeMigration, /existing_job\.workflow_id <> p_workflow_id or existing_job\.execution_mode <> p_execution_mode/);
  assert.match(dispatch, /requestBody\.mode/);
  assert.match(dispatch, /AIVANTA_LIVE_EXECUTION_ENABLED/);
  assert.match(dispatch, /p_execution_mode: executionMode/);
});


const waitMigration = readFileSync(
  new URL("../supabase/migrations/20261104120000_aivanta_durable_wait_resume.sql", import.meta.url),
  "utf8",
);

test("durable waits release leases, retain attempt count, and resume from due queue state", () => {
  assert.match(waitMigration, /'waiting'/);
  assert.match(waitMigration, /status = 'waiting' then j\.attempts else j\.attempts \+ 1 end/);
  assert.match(waitMigration, /j\.status = 'waiting' or j\.attempts < j\.max_attempts/);
  assert.match(waitMigration, /create or replace function public\.pause_execution_job/i);
  assert.match(waitMigration, /lease_token = p_lease_token and lease_until > now\(\)/);
  assert.match(workerService, /execution_checkpoints/);
  assert.match(workerService, /completedStepIds/);
  assert.match(workerService, /heartbeat_execution_job/);
  assert.match(workerService, /AIVANTA_JAVASCRIPT_SANDBOX_ENABLED === "true"/);
  assert.match(workerService, /step\.nodeId === "javascript"/);
  assert.match(workerService, /pause_execution_job/);
});


test("Rate Limiter uses a workspace-scoped atomic sliding-window RPC", () => {
  assert.match(utilityMigration, /pg_advisory_xact_lock/);
  assert.match(utilityMigration, /workspace_id,key_hash,hit_at/);
  assert.match(utilityMigration, /consume_execution_rate_limit/);
  assert.match(workerService, /db\.rpc\("consume_execution_rate_limit"/);
  assert.match(workerService, /RATE_LIMIT_BACKEND_UNAVAILABLE/);
  assert.match(workerService, /rateLimit: \{ async consume/);
});

test("Error Trigger dispatches active same-workspace subscribers through the durable queue", () => {
  assert.match(utilityMigration, /create or replace function public\.dispatch_execution_error_event/i);
  assert.match(utilityMigration, /w\.workspace_id = event_row\.workspace_id/);
  assert.match(utilityMigration, /w\.status = 'active'/);
  assert.match(utilityMigration, /w\.definition->'steps'->0->>'nodeId' = 'error_trigger'/);
  assert.match(utilityMigration, /'error:' \|\| event_row\.id::text/);
  assert.match(utilityMigration, /'source','error_trigger','input',event_input/);
  assert.match(utilityMigration, /record_and_dispatch_execution_error_event/);
  assert.match(utilityMigration, /source_mode <> 'live'/);
  assert.match(utilityMigration, /dispatch_status text not null default 'pending'/);
  assert.match(utilityMigration, /create or replace function public\.dispatch_pending_execution_error_events/);
  assert.match(utilityMigration, /create or replace function public\.finish_execution_job/);
  assert.match(utilityMigration, /p_error_step_id text default null/);
  assert.match(utilityIndexesMigration, /add column if not exists id bigint generated by default as identity/);
  assert.match(utilityIndexesMigration, /primary key \(id\)/);
  assert.match(utilityIndexesMigration, /execution_error_events_workflow_idx/);
  assert.match(utilityIndexesMigration, /execution_error_events_run_idx/);
  assert.match(workerService, /db\.rpc\("dispatch_pending_execution_error_events"/);
  assert.match(workerService, /p_error_step_id: workflowErrorEvent\.current\?\.stepId/);
  assert.match(utilityMigration, /dispatch_workflow_execution/);
  assert.match(utilityMigration, /'live'/);
  assert.match(workerService, /db\.rpc\("record_and_dispatch_execution_error_event"/);
  assert.match(workerService, /source !== "error_trigger"/);
  assert.match(workerService, /job\.execution_mode === "live" && source !== "error_trigger"/);
  assert.match(workerService, /source === "error_trigger"/);
  assert.match(workerService, /step\.nodeId === "error_trigger"/);
});
