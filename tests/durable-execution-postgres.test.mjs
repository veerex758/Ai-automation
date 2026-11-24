import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import pg from "pg";

const { Pool } = pg;
const connectionString = process.env.TEST_DATABASE_URL;
const enabled = process.env.AIVANTA_TEST_DB === "1" && Boolean(connectionString);
const pool = enabled ? new Pool({ connectionString, max: 8 }) : null;
const migration = await readFile(
  new URL("../supabase/migrations/20261031100000_aivanta_durable_execution_queue.sql", import.meta.url),
  "utf8",
);
const liveModeMigration = await readFile(
  new URL("../supabase/migrations/20261102090000_aivanta_live_durable_execution_mode.sql", import.meta.url),
  "utf8",
);
const utilityMigration = await readFile(
  new URL("../supabase/migrations/20261105045346_aivanta_utility_execution_hardening.sql", import.meta.url),
  "utf8",
);
const utilityIndexesMigration = await readFile(
  new URL("../supabase/migrations/20261105045900_aivanta_utility_execution_indexes.sql", import.meta.url),
  "utf8",
);
const cancellationMigration = await readFile(
  new URL("../supabase/migrations/20261114072354_aivanta_execution_cancellation.sql", import.meta.url),
  "utf8",
);
const webhookQueueMigration = await readFile(
  new URL("../supabase/migrations/20261114072358_aivanta_durable_webhook_live_queue.sql", import.meta.url),
  "utf8",
);
const workflowRunCancellationMigration = await readFile(
  new URL("../supabase/migrations/20261114072907_aivanta_workflow_run_cancellation_status.sql", import.meta.url),
  "utf8",
);
const runtimeReconciliationMigration = await readFile(
  new URL("../supabase/migrations/20261114074228_aivanta_staging_runtime_reconciliation.sql", import.meta.url),
  "utf8",
);
const reliabilityMigration = await readFile(
  new URL("../supabase/migrations/20261124130000_rexnora_execution_reliability_retries.sql", import.meta.url),
  "utf8",
);
const deadLetterRecoveryMigration = await readFile(
  new URL("../supabase/migrations/20261117190000_rexnora_dry_run_dead_letter_recovery.sql", import.meta.url),
  "utf8",
);
const ids = {
  workspace: "10000000-0000-4000-8000-000000000001",
  workflow: "20000000-0000-4000-8000-000000000001",
  workflowOther: "20000000-0000-4000-8000-000000000002",
  user: "30000000-0000-4000-8000-000000000001",
  workspaceOther: "10000000-0000-4000-8000-000000000002",
};
let ready = false;

async function client() {
  return pool.connect();
}
async function dispatch(db, key, maxAttempts = 3) {
  const { rows } = await db.query(
    "select public.dispatch_workflow_execution($1,$2,1,$3,$4,'{}'::jsonb,$5) as result",
    [ids.workspace, ids.workflow, ids.user, key, maxAttempts],
  );
  return rows[0].result;
}
async function claim(db, worker, limit = 1, leaseSeconds = 15) {
  const { rows } = await db.query(
    "select * from public.claim_execution_jobs($1,$2,$3)",
    [worker, limit, leaseSeconds],
  );
  return rows;
}
async function resetFixture() {
  const db = await client();
  try {
    await db.query(`
      truncate table
        public.execution_error_events,
        public.execution_rate_limit_hits,
        public.execution_dead_letters,
        public.execution_checkpoints,
        public.execution_jobs,
        public.workflow_runs
      restart identity cascade
    `);
    // Each subtest starts from workflow version 1 so a prior version-pinning
    // assertion cannot leak mutated fixture state into later dispatch tests.
    await db.query(
      "update public.workflows set version=1,status='active',definition=$1::jsonb,created_by=$2 where id=$3",
      [JSON.stringify({ version: 1, nodes: [] }), ids.user, ids.workflow],
    );
  } finally {
    await db.query("reset role").catch(() => {});
    db.release();
  }
}

test("PostgreSQL durable execution integration", { skip: !enabled, timeout: 60000 }, async (t) => {
  const parsed = new URL(connectionString);
  assert.equal(parsed.pathname.replace(/^\//, ""), "aivanta_test",
    "Refusing to run destructive integration setup outside the dedicated aivanta_test database");

  const setup = await client();
  try {
    await setup.query(`
      drop table if exists public.execution_dead_letter_recoveries cascade;
      drop table if exists public.execution_error_events, public.execution_rate_limit_hits, public.execution_dead_letters, public.execution_checkpoints, public.execution_jobs cascade;
      drop table if exists public.workspace_integration_secrets, public.workspace_integrations, public.workspace_members, public.google_connections cascade;
      drop table if exists public.workflow_runs, public.workflows, public.workspaces cascade;
      do $$ begin
        if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
        if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
        if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
      end $$;
      create table public.workspaces (id uuid primary key, owner_id uuid);
      create table public.workspace_members (workspace_id uuid, user_id uuid, role text);
      create table public.google_connections (id uuid primary key default gen_random_uuid(), workspace_id uuid, product text);
      create table public.workspace_integrations (
        id uuid primary key default gen_random_uuid(), workspace_id uuid not null,
        provider text not null, status text not null, display_name text not null,
        created_by uuid not null, updated_at timestamptz not null default now(),
        unique (workspace_id, provider)
      );
      create table public.workspace_integration_secrets (
        integration_id uuid primary key, encrypted_credentials text not null,
        encryption_version text not null, updated_at timestamptz not null default now()
      );
      create table public.workflows (
        id uuid primary key, workspace_id uuid not null references public.workspaces(id),
        version integer not null, status text not null,
        definition jsonb not null default '{"version":1,"nodes":[]}'::jsonb,
        created_by uuid
      );
      create table public.workflow_runs (
        id uuid primary key default gen_random_uuid(),
        workspace_id uuid not null, workflow_id uuid not null,
        workflow_version integer not null, mode text not null, status text not null,
        created_by uuid not null, idempotency_key text not null,
        started_at timestamptz, completed_at timestamptz, duration_ms integer,
        error_message text
      );
      grant usage on schema public to anon, authenticated, service_role;
    `);
    await setup.query("insert into public.workspaces (id,owner_id) values ($1,$3),($2,$3)", [ids.workspace, ids.workspaceOther, ids.user]);
    await setup.query(
      "insert into public.workflows (id,workspace_id,version,status,definition,created_by) values ($1,$2,1,'active',$3::jsonb,$4),($5,$2,1,'active',$3::jsonb,$4)",
      [ids.workflow, ids.workspace, JSON.stringify({ version: 1, nodes: [] }), ids.user, ids.workflowOther],
    );
    await setup.query(migration);
    await setup.query(liveModeMigration);
    await setup.query(utilityMigration);
    await setup.query(utilityIndexesMigration);
    await setup.query(cancellationMigration);
    await setup.query(webhookQueueMigration);
    await setup.query(workflowRunCancellationMigration);
    await setup.query(runtimeReconciliationMigration);
    await setup.query(deadLetterRecoveryMigration);
    await setup.query(reliabilityMigration);
    ready = true;
  } finally {
    setup.release();
  }


  await t.test("live dispatch caps explicitly approved retries and the legacy RPC stays dry-run", async () => {
    await resetFixture();
    const db = await client();
    try {
      const dry = await dispatch(db, crypto.randomUUID(), 4);
      const dryJob = await db.query("select execution_mode,max_attempts from public.execution_jobs where id=$1", [dry.job_id]);
      assert.equal(dryJob.rows[0].execution_mode, "dry_run");
      assert.equal(dryJob.rows[0].max_attempts, 4);

      const key = crypto.randomUUID();
      const live = await db.query(
        "select public.dispatch_workflow_execution($1,$2,1,$3,$4,'{}'::jsonb,5,'live') as result",
        [ids.workspace, ids.workflow, ids.user, key],
      );
      const liveResult = live.rows[0].result;
      const liveJob = await db.query("select execution_mode,max_attempts from public.execution_jobs where id=$1", [liveResult.job_id]);
      assert.equal(liveJob.rows[0].execution_mode, "live");
      assert.equal(liveJob.rows[0].max_attempts, 3, "trusted live dispatch may request at most three attempts");
    } finally { db.release(); }
  });

  await t.test("idempotency keys cannot be reused across workflow IDs or execution modes", async () => {
    await resetFixture();
    const db = await client();
    const key = crypto.randomUUID();
    try {
      await dispatch(db, key);
      await assert.rejects(
        db.query(
          "select public.dispatch_workflow_execution($1,$2,1,$3,$4,'{}'::jsonb,5,'live')",
          [ids.workspace, ids.workflowOther, ids.user, key],
        ),
        (error) => error.code === "23505",
      );
    } finally { db.release(); }
  });

  await t.test("two competing workers never receive the same job", async () => {
    await resetFixture();
    const a = await client(), b = await client();
    try {
      await dispatch(a, crypto.randomUUID());
      await dispatch(a, crypto.randomUUID());
      const [left, right] = await Promise.all([claim(a, "worker-A"), claim(b, "worker-B")]);
      assert.equal(left.length, 1);
      assert.equal(right.length, 1);
      assert.notEqual(left[0].id, right[0].id);
      assert.notEqual(left[0].lease_token, right[0].lease_token);
    } finally { a.release(); b.release(); }
  });

  await t.test("dispatch pins the queued workflow definition despite later edits", async () => {
    await resetFixture();
    const db = await client();
    const originalDefinition = { version: 1, nodes: [{ id: "original", type: "trigger", title: "Original" }] };
    try {
      await db.query("update public.workflows set definition=$1::jsonb where id=$2", [JSON.stringify(originalDefinition), ids.workflow]);
      const created = await dispatch(db, crypto.randomUUID());
      await db.query(
        "update public.workflows set version=2, definition=$1::jsonb where id=$2",
        [JSON.stringify({ version: 2, nodes: [{ id: "changed", type: "trigger", title: "Changed" }] }), ids.workflow],
      );
      const [job] = await claim(db, "snapshot-worker", 1, 30);
      assert.equal(job.id, created.job_id);
      assert.equal(job.workflow_version, 1);
      assert.deepEqual(job.workflow_definition, originalDefinition);
    } finally { db.release(); }
  });

  await t.test("concurrent duplicate delivery creates exactly one run and one job", async () => {
    await resetFixture();
    const a = await client(), b = await client();
    const key = crypto.randomUUID();
    try {
      const [one, two] = await Promise.all([dispatch(a, key), dispatch(b, key)]);
      assert.equal(one.job_id, two.job_id);
      assert.equal(one.run_id, two.run_id);
      assert.deepEqual([one.duplicate, two.duplicate].sort(), [false, true]);
      const count = await a.query(
        "select (select count(*) from public.execution_jobs where workspace_id=$1 and idempotency_key=$2) jobs, (select count(*) from public.workflow_runs where workspace_id=$1 and idempotency_key=$2) runs",
        [ids.workspace, key],
      );
      assert.equal(Number(count.rows[0].jobs), 1);
      assert.equal(Number(count.rows[0].runs), 1);
    } finally { a.release(); b.release(); }
  });

  await t.test("worker process loss is recovered after its lease expires", async () => {
    await resetFixture();
    const deadWorker = await client();
    const key = crypto.randomUUID();
    let job;
    try {
      await dispatch(deadWorker, key);
      [job] = await claim(deadWorker, "worker-that-will-die", 1, 15);
      assert.ok(job?.lease_token);
      // Simulate process death: release the connection without finishing the job.
    } finally { deadWorker.release(); }
    await new Promise(resolve => setTimeout(resolve, 16000));
    const replacement = await client();
    try {
      const recovered = await claim(replacement, "replacement-worker", 1, 30);
      assert.equal(recovered.length, 1);
      assert.equal(recovered[0].id, job.id);
      assert.notEqual(recovered[0].lease_token, job.lease_token);
      assert.equal(recovered[0].attempts, 2);
    } finally { replacement.release(); }
  });

  await t.test("waiting jobs resume without consuming another retry attempt", async () => {
    await resetFixture();
    const db = await client();
    try {
      const created = await dispatch(db, crypto.randomUUID(), 3);
      const [first] = await claim(db, "pause-worker", 1, 30);
      assert.equal(first.id, created.job_id);
      assert.equal(first.attempts, 1);
      const paused = await db.query(
        "select public.pause_execution_job($1,$2,1) as paused",
        [first.id, first.lease_token],
      );
      assert.equal(paused.rows[0].paused, true);
      await db.query("update public.execution_jobs set available_at=now()-interval '1 second' where id=$1", [first.id]);
      const [resumed] = await claim(db, "resume-worker", 1, 30);
      assert.equal(resumed.id, first.id);
      assert.equal(resumed.status, "running");
      assert.equal(resumed.attempts, 1);
      const finished = await db.query(
        "select public.finish_execution_job($1,$2,true,null,null,null) as status",
        [resumed.id, resumed.lease_token],
      );
      assert.equal(finished.rows[0].status, "succeeded");
    } finally { db.release(); }
  });

  await t.test("cancellation requested on a leased job wins over expired-lease recovery", async () => {
    await resetFixture();
    const db = await client();
    try {
      const created = await dispatch(db, crypto.randomUUID(), 3);
      const [leased] = await claim(db, "cancelled-worker", 1, 30);
      assert.equal(leased.id, created.job_id);
      const requested = await db.query(
        "select public.cancel_execution_job($1,$2,$3) as status",
        [leased.id, ids.workspace, ids.workflow],
      );
      assert.equal(requested.rows[0].status, "cancellation_requested");
      await db.query(
        "update public.execution_jobs set lease_until=now()-interval '1 second' where id=$1",
        [leased.id],
      );
      const reclaimed = await claim(db, "replacement-after-cancel", 1, 30);
      assert.equal(reclaimed.length, 0);
      const state = await db.query(
        "select j.status job_status,r.status run_status from public.execution_jobs j join public.workflow_runs r on r.id=j.run_id where j.id=$1",
        [leased.id],
      );
      assert.deepEqual(state.rows[0], { job_status: "cancelled", run_status: "cancelled" });
    } finally { db.release(); }
  });

  await t.test("retry exhaustion atomically dead-letters and fails the run", async () => {
    await resetFixture();
    const db = await client();
    const key = crypto.randomUUID();
    try {
      const created = await dispatch(db, key, 2);
      const [first] = await claim(db, "retry-worker-1", 1, 30);
      assert.equal(first.id, created.job_id);
      const firstFinish = await db.query(
        "select public.finish_execution_job($1,$2,false,'PROVIDER_TRANSIENT_FAILURE',null,null) as status",
        [first.id, first.lease_token],
      );
      assert.equal(firstFinish.rows[0].status, "retry_wait");
      await db.query("update public.execution_jobs set available_at=now()-interval '1 second' where id=$1", [first.id]);
      const [second] = await claim(db, "retry-worker-2", 1, 30);
      assert.equal(second.attempts, 2);
      const secondFinish = await db.query(
        "select public.finish_execution_job($1,$2,false,'PROVIDER_TRANSIENT_FAILURE',null,null) as status",
        [second.id, second.lease_token],
      );
      assert.equal(secondFinish.rows[0].status, "dead_letter");
      const state = await db.query(`
        select j.status job_status, d.error_code, r.status run_status
        from public.execution_jobs j
        join public.execution_dead_letters d on d.original_job_id=j.id
        join public.workflow_runs r on r.id=j.run_id
        where j.id=$1
      `, [first.id]);
      assert.deepEqual(state.rows[0], {
        job_status: "dead_letter", error_code: "PROVIDER_TRANSIENT_FAILURE", run_status: "failed",
      });
    } finally { db.release(); }
  });


  await t.test("transient live provider failure retries the same idempotent job and can then succeed", async () => {
    await resetFixture();
    const db = await client();
    try {
      const dispatched = await db.query(
        "select public.dispatch_workflow_execution($1,$2,1,$3,$4,'{}'::jsonb,3,'live') as result",
        [ids.workspace, ids.workflow, ids.user, crypto.randomUUID()],
      );
      const [first] = await claim(db, "transient-provider-worker");
      assert.equal(first.id, dispatched.rows[0].result.job_id);
      assert.equal(first.attempts, 1);
      const retry = await db.query(
        "select public.finish_execution_job($1,$2,false,'EMAIL_RATE_LIMITED','email-step','EMAIL_RATE_LIMITED') as status",
        [first.id, first.lease_token],
      );
      assert.equal(retry.rows[0].status, "retry_wait");
      await db.query("update public.execution_jobs set available_at=now()-interval '1 second' where id=$1", [first.id]);
      const [second] = await claim(db, "transient-provider-retry-worker");
      assert.equal(second.id, first.id);
      assert.equal(second.attempts, 2);
      const completed = await db.query(
        "select public.finish_execution_job($1,$2,true,null,null,null) as status",
        [second.id, second.lease_token],
      );
      assert.equal(completed.rows[0].status, "succeeded");
      const state = await db.query(
        "select j.status job_status,j.attempts,r.status run_status from public.execution_jobs j join public.workflow_runs r on r.id=j.run_id where j.id=$1",
        [first.id],
      );
      assert.deepEqual(state.rows[0], { job_status: "succeeded", attempts: 2, run_status: "succeeded" });
    } finally { db.release(); }
  });

  await t.test("permanent live provider rejection bypasses retries and dead-letters immediately", async () => {
    await resetFixture();
    const db = await client();
    try {
      const dispatched = await db.query(
        "select public.dispatch_workflow_execution($1,$2,1,$3,$4,'{}'::jsonb,3,'live') as result",
        [ids.workspace, ids.workflow, ids.user, crypto.randomUUID()],
      );
      const [job] = await claim(db, "permanent-error-worker");
      assert.equal(job.id, dispatched.rows[0].result.job_id);
      assert.equal(job.max_attempts, 3);
      const finished = await db.query(
        "select public.finish_execution_job($1,$2,false,'EMAIL_PROVIDER_REJECTED','email-step','EMAIL_PROVIDER_REJECTED') as status",
        [job.id, job.lease_token],
      );
      assert.equal(finished.rows[0].status, "dead_letter");
      const state = await db.query(
        "select status,last_error_code,attempts from public.execution_jobs where id=$1",
        [job.id],
      );
      assert.deepEqual(state.rows[0], {
        status: "dead_letter", last_error_code: "EMAIL_PROVIDER_REJECTED", attempts: 1,
      });
    } finally { db.release(); }
  });

  await t.test("shared rate limiter is atomic and isolates workspaces", async () => {
    await resetFixture();
    const clients = await Promise.all([client(), client(), client()]);
    try {
      const results = await Promise.all(clients.map((db) => db.query(
        "select public.consume_execution_rate_limit($1,'checkout',2,60000) as result",
        [ids.workspace],
      )));
      const decisions = results.map((item) => item.rows[0].result.allowed).sort();
      assert.deepEqual(decisions, [false, true, true]);
      const isolated = await clients[0].query(
        "select public.consume_execution_rate_limit($1,'checkout',2,60000) as result",
        [ids.workspaceOther],
      );
      assert.equal(isolated.rows[0].result.allowed, true);
    } finally { clients.forEach((db) => db.release()); }
  });

  await t.test("workflow failures atomically enqueue active Error Trigger subscribers", async () => {
    await resetFixture();
    const db = await client();
    try {
      const subscriberDefinition = {
        format: "aivanta-registry-v1",
        steps: [{ id: "on-error", nodeId: "error_trigger", operationId: "capture", kind: "trigger",
          input: { code: "TEST_FAILURE", message: "Test failure" } }],
      };
      await db.query(
        "update public.workflows set definition=$1::jsonb where id=$2",
        [JSON.stringify(subscriberDefinition), ids.workflowOther],
      );
      await db.query(
        "select public.dispatch_workflow_execution($1,$2,1,$3,$4,'{}'::jsonb,1,'live') as result",
        [ids.workspace, ids.workflow, ids.user, crypto.randomUUID()],
      );
      const [job] = await claim(db, "error-source-worker");
      const result = await db.query(
        "select public.record_and_dispatch_execution_error_event($1,$2,'step-a','TEST_FAILURE','TEST_FAILURE',1) as dispatched",
        [job.id, job.lease_token],
      );
      assert.equal(result.rows[0].dispatched, 1);
      const duplicate = await db.query(
        "select public.record_and_dispatch_execution_error_event($1,$2,'step-a','TEST_FAILURE','TEST_FAILURE',1) as dispatched",
        [job.id, job.lease_token],
      );
      assert.equal(duplicate.rows[0].dispatched, 0);
      const queued = await db.query(
        "select execution_mode,payload from public.execution_jobs where workflow_id=$1 and idempotency_key like 'error:%'",
        [ids.workflowOther],
      );
      assert.equal(queued.rowCount, 1);
      assert.equal(queued.rows[0].execution_mode, "live");
      assert.equal(queued.rows[0].payload.source, "error_trigger");
      assert.equal(queued.rows[0].payload.input.code, "TEST_FAILURE");
      assert.match(queued.rows[0].payload.input.occurredAt, /Z$/);
      const [subscriberJob] = await claim(db, "error-subscriber-worker");
      assert.equal(subscriberJob.payload.source, "error_trigger");
      const nested = await db.query(
        "select public.record_and_dispatch_execution_error_event($1,$2,'handler-step','HANDLER_FAILED','HANDLER_FAILED',1) as dispatched",
        [subscriberJob.id, subscriberJob.lease_token],
      );
      assert.equal(nested.rows[0].dispatched, 0);
      const noRecursion = await db.query(
        "select count(*)::integer as count from public.execution_jobs where idempotency_key like 'error:%'",
      );
      assert.equal(noRecursion.rows[0].count, 1);
    } finally { db.release(); }
  });


  await t.test("dry-run failures are recorded without launching live Error Trigger workflows", async () => {
    await resetFixture();
    const db = await client();
    try {
      await db.query(
        "update public.workflows set definition=$1::jsonb where id=$2",
        [JSON.stringify({ format: "aivanta-registry-v1", steps: [{ id: "on-error", nodeId: "error_trigger", operationId: "capture", kind: "trigger", input: { code: "TEST_FAILURE", message: "Test failure" } }] }), ids.workflowOther],
      );
      await dispatch(db, crypto.randomUUID());
      const [job] = await claim(db, "dry-run-error-worker");
      const result = await db.query(
        "select public.record_and_dispatch_execution_error_event($1,$2,'step-a','TEST_FAILURE','TEST_FAILURE',1) as dispatched",
        [job.id, job.lease_token],
      );
      assert.equal(result.rows[0].dispatched, 0);
      const queued = await db.query("select count(*)::integer as count from public.execution_jobs where idempotency_key like 'error:%'");
      assert.equal(queued.rows[0].count, 0);
    } finally { db.release(); }
  });


  await t.test("job finalization persists failed live runs to the retryable Error Trigger outbox", async () => {
    await resetFixture();
    const db = await client();
    try {
      const subscriberDefinition = {
        format: "aivanta-registry-v1",
        steps: [{ id: "on-error", nodeId: "error_trigger", operationId: "capture", kind: "trigger",
          input: { code: "PLACEHOLDER", message: "Placeholder" } }],
      };
      await db.query(
        "update public.workflows set definition=$1::jsonb where id=$2",
        [JSON.stringify(subscriberDefinition), ids.workflowOther],
      );
      await db.query(
        "select public.dispatch_workflow_execution($1,$2,1,$3,$4,'{}'::jsonb,1,'live')",
        [ids.workspace, ids.workflow, ids.user, crypto.randomUUID()],
      );
      const [job] = await claim(db, "outbox-source-worker");
      const finished = await db.query(
        "select public.finish_execution_job($1,$2,false,'PROVIDER_TRANSIENT_FAILURE','step-a','PROVIDER_TRANSIENT_FAILURE') as result",
        [job.id, job.lease_token],
      );
      assert.equal(finished.rows[0].result, "dead_letter");
      const pending = await db.query(
        "select dispatch_status,error_code,step_id from public.execution_error_events where job_id=$1",
        [job.id],
      );
      assert.equal(pending.rowCount, 1);
      assert.equal(pending.rows[0].dispatch_status, "pending");
      assert.equal(pending.rows[0].error_code, "TEST_FAILURE");
      assert.equal(pending.rows[0].step_id, "step-a");
      const dispatched = await db.query("select public.dispatch_pending_execution_error_events(10) as count");
      assert.equal(dispatched.rows[0].count, 1);
      const queued = await db.query(
        "select payload from public.execution_jobs where workflow_id=$1 and idempotency_key like 'error:%'",
        [ids.workflowOther],
      );
      assert.equal(queued.rowCount, 1);
      assert.equal(queued.rows[0].payload.source, "error_trigger");
      const event = await db.query(
        "select dispatch_status,dispatched_at from public.execution_error_events where job_id=$1",
        [job.id],
      );
      assert.equal(event.rows[0].dispatch_status, "dispatched");
      assert.ok(event.rows[0].dispatched_at);
    } finally { db.release(); }
  });


  await t.test("pending Error Trigger deliveries retry after a transient queue insert failure", async () => {
    await resetFixture();
    const db = await client();
    try {
      const subscriberDefinition = {
        format: "aivanta-registry-v1",
        steps: [{ id: "on-error", nodeId: "error_trigger", operationId: "capture", kind: "trigger",
          input: { code: "PLACEHOLDER", message: "Placeholder" } }],
      };
      await db.query(
        "update public.workflows set definition=$1::jsonb where id=$2",
        [JSON.stringify(subscriberDefinition), ids.workflowOther],
      );
      await db.query(
        "select public.dispatch_workflow_execution($1,$2,1,$3,$4,'{}'::jsonb,1,'live')",
        [ids.workspace, ids.workflow, ids.user, crypto.randomUUID()],
      );
      const [job] = await claim(db, "outbox-retry-source-worker");
      const event = await db.query(
        "select public.record_execution_error_event($1,$2,'step-retry','SUBSCRIBER_SETUP','SUBSCRIBER_SETUP',1) as id",
        [job.id, job.lease_token],
      );
      await db.query(`
        create or replace function public.test_fail_error_trigger_job_insert()
        returns trigger language plpgsql as $$
        begin
          if new.payload->>'source' = 'error_trigger' then
            raise exception 'simulated transient queue insert failure';
          end if;
          return new;
        end;
        $$;
      `);
      await db.query(`
        create trigger test_fail_error_trigger_job_insert
        before insert on public.execution_jobs
        for each row execute function public.test_fail_error_trigger_job_insert()
      `);
      const first = await db.query("select public.dispatch_pending_execution_error_events(10) as count");
      assert.equal(first.rows[0].count, 1);
      const failed = await db.query(
        "select dispatch_status,dispatch_attempts,dispatch_error_code from public.execution_error_events where id=$1",
        [event.rows[0].id],
      );
      assert.equal(failed.rows[0].dispatch_status, "pending");
      assert.equal(failed.rows[0].dispatch_attempts, 1);
      assert.equal(failed.rows[0].dispatch_error_code, "ERROR_TRIGGER_DISPATCH_FAILED");
      await db.query("drop trigger test_fail_error_trigger_job_insert on public.execution_jobs");
      await db.query("drop function public.test_fail_error_trigger_job_insert()");
      const second = await db.query("select public.dispatch_pending_execution_error_events(10) as count");
      assert.equal(second.rows[0].count, 1);
      const queued = await db.query(
        "select count(*)::integer as count from public.execution_jobs where workflow_id=$1 and idempotency_key like 'error:%'",
        [ids.workflowOther],
      );
      assert.equal(queued.rows[0].count, 1);
      const succeeded = await db.query(
        "select dispatch_status,dispatch_attempts from public.execution_error_events where id=$1",
        [event.rows[0].id],
      );
      assert.equal(succeeded.rows[0].dispatch_status, "dispatched");
      assert.equal(succeeded.rows[0].dispatch_attempts, 2);
    } finally {
      await db.query("drop trigger if exists test_fail_error_trigger_job_insert on public.execution_jobs").catch(() => {});
      await db.query("drop function if exists public.test_fail_error_trigger_job_insert()").catch(() => {});
      db.release();
    }
  });

  await t.test("dead-letter recovery creates a new idempotent dry-run from the original immutable snapshot", async () => {
    await resetFixture();
    const db = await client();
    const requestId = crypto.randomUUID();
    try {
      const originalDefinition = { version: 1, nodes: [{ id: "saved-snapshot", type: "trigger" }] };
      const originalPayload = { source: "manual", input: { safeFixture: true } };
      // Start with a clean workspace fixture, then dispatch the exact saved definition.
      await resetFixture();
      await db.query("update public.workflows set definition=$1::jsonb where id=$2",
        [JSON.stringify(originalDefinition), ids.workflow]);
      const snapshotDispatch = await dispatch(db, crypto.randomUUID(), 2);
      await db.query("update public.execution_jobs set payload=$1::jsonb where id=$2",
        [JSON.stringify(originalPayload), snapshotDispatch.job_id]);
      const [first] = await claim(db, "recovery-worker-1");
      assert.equal(first.id, snapshotDispatch.job_id);
      await db.query("select public.finish_execution_job($1,$2,false,'PROVIDER_TRANSIENT_FAILURE',null,null)",
        [first.id, first.lease_token]);
      await db.query("update public.execution_jobs set available_at=now()-interval '1 second' where id=$1", [first.id]);
      const [second] = await claim(db, "recovery-worker-2");
      await db.query("select public.finish_execution_job($1,$2,false,'PROVIDER_TRANSIENT_FAILURE',null,null)",
        [second.id, second.lease_token]);

      const dead = await db.query("select id from public.execution_dead_letters where original_job_id=$1", [first.id]);
      assert.equal(dead.rowCount, 1);
      const createRecovery = () => db.query(
        "select public.create_dead_letter_dry_run_recovery($1,$2,$3,$4) as result",
        [dead.rows[0].id, ids.workspace, ids.user, requestId],
      );
      const created = (await createRecovery()).rows[0].result;
      assert.equal(created.mode, "dry_run");
      assert.equal(created.duplicate, false);
      const duplicate = (await createRecovery()).rows[0].result;
      assert.equal(duplicate.job_id, created.job_id);
      assert.equal(duplicate.run_id, created.run_id);
      assert.equal(duplicate.duplicate, true);

      const recoveredJob = await db.query(
        "select execution_mode,status,attempts,max_attempts,workflow_definition,payload from public.execution_jobs where id=$1",
        [created.job_id],
      );
      assert.deepEqual(recoveredJob.rows[0], {
        execution_mode: "dry_run", status: "queued", attempts: 0, max_attempts: 2,
        workflow_definition: originalDefinition, payload: originalPayload,
      });
      const recoveredRun = await db.query(
        "select mode,status,created_by from public.workflow_runs where id=$1",
        [created.run_id],
      );
      assert.deepEqual(recoveredRun.rows[0], { mode: "dry_run", status: "running", created_by: ids.user });
      const audit = await db.query(
        "select count(*)::integer as count from public.execution_dead_letter_recoveries where dead_letter_id=$1",
        [dead.rows[0].id],
      );
      assert.equal(audit.rows[0].count, 1);
      const original = await db.query("select status from public.execution_jobs where id=$1", [first.id]);
      assert.equal(original.rows[0].status, "dead_letter");
    } finally { db.release(); }
  });

  await t.test("operator recovery refuses a dead-lettered live job", async () => {
    await resetFixture();
    const db = await client();
    try {
      const key = crypto.randomUUID();
      const live = await db.query(
        "select public.dispatch_workflow_execution($1,$2,1,$3,$4,'{}'::jsonb,5,'live') as result",
        [ids.workspace, ids.workflow, ids.user, key],
      );
      const [job] = await claim(db, "live-recovery-worker");
      assert.equal(job.id, live.rows[0].result.job_id);
      await db.query("select public.finish_execution_job($1,$2,false,'UNCERTAIN_PROVIDER_OUTCOME',null,null)",
        [job.id, job.lease_token]);
      const dead = await db.query("select id from public.execution_dead_letters where original_job_id=$1", [job.id]);
      assert.equal(dead.rowCount, 1);
      await assert.rejects(
        db.query(
          "select public.create_dead_letter_dry_run_recovery($1,$2,$3,$4)",
          [dead.rows[0].id, ids.workspace, ids.user, crypto.randomUUID()],
        ),
        (error) => error.code === "22023",
      );
    } finally { db.release(); }
  });

  await t.test("browser roles cannot read queue tables or execute privileged RPCs", async () => {
    await resetFixture();
    const db = await client();
    try {
      await db.query("set role anon");
      await assert.rejects(db.query("select * from public.execution_jobs"), /permission denied/);
      await assert.rejects(
        db.query("select public.claim_execution_jobs('untrusted-client',1,30)"),
        /permission denied/,
      );
      await db.query("reset role");
      await db.query("set role authenticated");
      await assert.rejects(db.query("select * from public.execution_checkpoints"), /permission denied/);
      await assert.rejects(db.query("select * from public.execution_dead_letter_recoveries"), /permission denied/);
      await assert.rejects(
        db.query("select public.create_dead_letter_dry_run_recovery($1,$2,$3,$4)",
          ["40000000-0000-4000-8000-000000000001", ids.workspace, ids.user, crypto.randomUUID()]),
        /permission denied/,
      );
      await assert.rejects(
        db.query("select public.dispatch_workflow_execution($1,$2,1,$3,$4,'{}'::jsonb,3)",
          [ids.workspace, ids.workflow, ids.user, crypto.randomUUID()]),
        /permission denied/,
      );
    } finally {
      await db.query("reset role").catch(() => {});
      db.release();
    }
  });
});

test.after(async () => {
  if (pool) {
    if (ready) {
      const db = await pool.connect();
      try {
        await db.query("drop table if exists public.execution_dead_letter_recoveries cascade");
        await db.query("drop table if exists public.execution_error_events, public.execution_rate_limit_hits, public.execution_dead_letters, public.execution_checkpoints, public.execution_jobs cascade");
        await db.query("drop table if exists public.workspace_integration_secrets, public.workspace_integrations, public.workspace_members, public.google_connections cascade");
        await db.query("drop table if exists public.workflow_runs, public.workflows, public.workspaces cascade");
        await db.query("drop function if exists public.dispatch_workflow_execution(uuid,uuid,integer,uuid,text,jsonb,integer)");
        await db.query("drop function if exists public.dispatch_workflow_execution(uuid,uuid,integer,uuid,text,jsonb,integer,text)");
        await db.query("drop function if exists public.enqueue_execution_job(uuid,uuid,uuid,text,jsonb,integer)");
        await db.query("drop function if exists public.claim_execution_jobs(text,integer,integer)");
        await db.query("drop function if exists public.heartbeat_execution_job(uuid,uuid,integer)");
        await db.query("drop function if exists public.checkpoint_execution_step(uuid,uuid,text,integer,text,jsonb,jsonb)");
        await db.query("drop function if exists public.finish_execution_job(uuid,uuid,boolean,text)");
        await db.query("drop function if exists public.finish_execution_job(uuid,uuid,boolean,text,text,text)");
        await db.query("drop function if exists public.consume_execution_rate_limit(uuid,text,integer,integer)");
        await db.query("drop function if exists public.record_execution_error_event(uuid,uuid,text,text,text,integer)");
        await db.query("drop function if exists public.dispatch_pending_execution_error_events(integer)");
        await db.query("drop function if exists public.dispatch_execution_error_event(uuid)");
        await db.query("drop function if exists public.record_and_dispatch_execution_error_event(uuid,uuid,text,text,text,integer)");
      } finally {
        await db.query("reset role").catch(() => {});
        db.release();
      }
    }
    await pool.end();
  }
});
