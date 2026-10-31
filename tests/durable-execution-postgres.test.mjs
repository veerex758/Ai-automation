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
const ids = {
  workspace: "10000000-0000-4000-8000-000000000001",
  workflow: "20000000-0000-4000-8000-000000000001",
  user: "30000000-0000-4000-8000-000000000001",
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
        public.execution_dead_letters,
        public.execution_checkpoints,
        public.execution_jobs,
        public.workflow_runs
      restart identity cascade
    `);
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
      drop table if exists public.execution_dead_letters, public.execution_checkpoints, public.execution_jobs cascade;
      drop table if exists public.workflow_runs, public.workflows, public.workspaces cascade;
      do $$ begin
        if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
        if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
        if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
      end $$;
      create table public.workspaces (id uuid primary key);
      create table public.workflows (
        id uuid primary key, workspace_id uuid not null references public.workspaces(id),
        version integer not null, status text not null,
        definition jsonb not null default '{"version":1,"nodes":[]}'::jsonb
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
    await setup.query("insert into public.workspaces values ($1)", [ids.workspace]);
    await setup.query(
      "insert into public.workflows (id,workspace_id,version,status,definition) values ($1,$2,1,'active',$3::jsonb)",
      [ids.workflow, ids.workspace, JSON.stringify({ version: 1, nodes: [] })],
    );
    await setup.query(migration);
    ready = true;
  } finally {
    setup.release();
  }

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

  await t.test("retry exhaustion atomically dead-letters and fails the run", async () => {
    await resetFixture();
    const db = await client();
    const key = crypto.randomUUID();
    try {
      const created = await dispatch(db, key, 2);
      const [first] = await claim(db, "retry-worker-1", 1, 30);
      assert.equal(first.id, created.job_id);
      const firstFinish = await db.query(
        "select public.finish_execution_job($1,$2,false,'TEST_FAILURE') as status",
        [first.id, first.lease_token],
      );
      assert.equal(firstFinish.rows[0].status, "retry_wait");
      await db.query("update public.execution_jobs set available_at=now()-interval '1 second' where id=$1", [first.id]);
      const [second] = await claim(db, "retry-worker-2", 1, 30);
      assert.equal(second.attempts, 2);
      const secondFinish = await db.query(
        "select public.finish_execution_job($1,$2,false,'TEST_FAILURE') as status",
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
        job_status: "dead_letter", error_code: "TEST_FAILURE", run_status: "failed",
      });
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
        await db.query("drop table if exists public.execution_dead_letters, public.execution_checkpoints, public.execution_jobs cascade");
        await db.query("drop table if exists public.workflow_runs, public.workflows, public.workspaces cascade");
        await db.query("drop function if exists public.dispatch_workflow_execution(uuid,uuid,integer,uuid,text,jsonb,integer)");
        await db.query("drop function if exists public.enqueue_execution_job(uuid,uuid,uuid,text,jsonb,integer)");
        await db.query("drop function if exists public.claim_execution_jobs(text,integer,integer)");
        await db.query("drop function if exists public.heartbeat_execution_job(uuid,uuid,integer)");
        await db.query("drop function if exists public.checkpoint_execution_step(uuid,uuid,text,integer,text,jsonb,jsonb)");
        await db.query("drop function if exists public.finish_execution_job(uuid,uuid,boolean,text)");
      } finally {
        await db.query("reset role").catch(() => {});
        db.release();
      }
    }
    await pool.end();
  }
});
