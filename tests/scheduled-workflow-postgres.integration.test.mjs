import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { randomUUID } from "node:crypto";

const databaseUrl = process.env.TEST_DATABASE_URL;
const migrationPaths = [
  "../supabase/migrations/20261010194010_aivanta_workflow_run_history.sql",
  "../supabase/migrations/20261010201327_aivanta_live_email_runs.sql",
  "../supabase/migrations/20261010201538_index_workflow_runs_created_by.sql",
  "../supabase/migrations/20261010203527_harden_live_run_step_ownership.sql",
  "../supabase/migrations/20261010203630_harden_workflow_run_step_inserts.sql",
  "../supabase/migrations/20261010204255_allow_incomplete_workflow_run_timestamps.sql",
  "../supabase/migrations/20261011090000_scheduled_workflow_foundation.sql",
  "../supabase/migrations/20261011091000_scheduled_workflow_dispatcher.sql",
];

const bootstrapSql = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable
as $auth_uid$ select null::uuid $auth_uid$;

create schema private;
grant usage on schema private to authenticated;
create function private.is_workspace_member(target_workspace_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $workspace_member$ select true $workspace_member$;

create table public.workspaces (
  id uuid primary key,
  owner_id uuid not null references auth.users(id),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workflows (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  description text not null default '',
  definition jsonb not null,
  status text not null default 'draft',
  version integer not null default 1,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function public.set_updated_at() returns trigger
language plpgsql set search_path = ''
as $set_updated_at$
begin
  new.updated_at = now();
  return new;
end;
$set_updated_at$;
`;

async function insertWorkflowAndSchedule(client, workspaceId, userId) {
  const workflowId = randomUUID();
  const scheduleId = randomUUID();
  const definition = {
    version: 1,
    nodes: [
      {
        id: "trigger_1",
        type: "trigger",
        title: "Scheduled",
        description: "",
        settings: { event: "schedule" },
      },
      {
        id: "action_1",
        type: "action",
        title: "Create task",
        description: "",
        settings: { provider: "internal", operation: "create_task" },
      },
    ],
  };

  await client.query(
    "insert into public.workflows (id, workspace_id, name, definition, status, version, created_by) values ($1, $2, $3, $4::jsonb, 'active', 1, $5)",
    [workflowId, workspaceId, "Scheduled test", JSON.stringify(definition), userId],
  );
  await client.query(
    "insert into public.workflow_schedules (id, workflow_id, workspace_id, interval_minutes, enabled, next_run_at, created_by) values ($1, $2, $3, 15, true, now() - interval '1 minute', $4)",
    [scheduleId, workflowId, workspaceId, userId],
  );
  return { workflowId, scheduleId, definition };
}

test("PostgreSQL executes scheduled claim, persistence, lease, retry, and idempotency flows", { skip: !databaseUrl }, async () => {
  const client = new Client({ connectionString: databaseUrl });
  const secondClient = new Client({ connectionString: databaseUrl });
  await client.connect();
  await secondClient.connect();

  try {
    await client.query(bootstrapSql);
    for (const path of migrationPaths) {
      const sql = readFileSync(new URL(path, import.meta.url), "utf8");
      await client.query(sql);
    }

    const userId = randomUUID();
    const workspaceId = randomUUID();
    await client.query("insert into auth.users (id) values ($1)", [userId]);
    await client.query(
      "insert into public.workspaces (id, owner_id, name) values ($1, $2, 'Scheduler test workspace')",
      [workspaceId, userId],
    );

    const first = await insertWorkflowAndSchedule(client, workspaceId, userId);
    const initialClaims = await client.query(
      "select * from public.claim_due_workflow_schedules($1, $2)",
      [10, 300],
    );
    assert.equal(initialClaims.rows.length, 1);
    const firstClaim = initialClaims.rows[0];
    assert.equal(firstClaim.schedule_id, first.scheduleId);

    const stepResults = [
      {
        step_id: "trigger_1",
        step_type: "trigger",
        title: "Scheduled",
        status: "simulated",
        result: { message: "Trigger recognized. No external event was consumed." },
      },
      {
        step_id: "action_1",
        step_type: "action",
        title: "Create task",
        status: "simulated",
        result: { message: "Task creation simulated. No external task was created." },
      },
    ];
    const recordSql = "select * from public.record_scheduled_workflow_run($1, $2, $3, $4, $5::jsonb)";
    const unsafeStepResults = stepResults.map((step) => ({ ...step, status: "executed" }));
    await assert.rejects(
      client.query(recordSql, [
        firstClaim.schedule_id,
        firstClaim.lease_token,
        firstClaim.workflow_version,
        12,
        JSON.stringify(unsafeStepResults),
      ]),
      /side-effect-free dry-runs/,
    );
    const recordArgs = [
      firstClaim.schedule_id,
      firstClaim.lease_token,
      firstClaim.workflow_version,
      12,
      JSON.stringify(stepResults),
    ];
    const recorded = await client.query(recordSql, recordArgs);
    const repeated = await client.query(recordSql, recordArgs);
    assert.equal(recorded.rows[0].run_id, repeated.rows[0].run_id);

    const runHistory = await client.query(
      "select mode, status, workflow_version from public.workflow_runs where id = $1",
      [recorded.rows[0].run_id],
    );
    assert.deepEqual(runHistory.rows[0], {
      mode: "dry_run",
      status: "succeeded",
      workflow_version: 1,
    });
    const stepCount = await client.query(
      "select count(*)::int as count from public.workflow_run_steps where run_id = $1",
      [recorded.rows[0].run_id],
    );
    assert.equal(stepCount.rows[0].count, 2);

    const renewed = await client.query(
      "select public.renew_workflow_schedule_claim($1, $2, 300) as renewed",
      [firstClaim.schedule_id, firstClaim.lease_token],
    );
    assert.equal(renewed.rows[0].renewed, true);
    const finished = await client.query(
      "select public.finish_workflow_schedule_claim($1, $2, true, null) as finished",
      [firstClaim.schedule_id, firstClaim.lease_token],
    );
    assert.equal(finished.rows[0].finished, true);
    const staleFinish = await client.query(
      "select public.finish_workflow_schedule_claim($1, $2, true, null) as finished",
      [firstClaim.schedule_id, firstClaim.lease_token],
    );
    assert.equal(staleFinish.rows[0].finished, false);

    // Simulate a committed history write whose RPC response was lost. The
    // worker reports failure, but finalization must recognize the durable run
    // and advance the original occurrence instead of creating a retry key.
    const ambiguous = await insertWorkflowAndSchedule(client, workspaceId, userId);
    const ambiguousClaims = await client.query(
      "select * from public.claim_due_workflow_schedules(10, 300)",
    );
    const ambiguousClaim = ambiguousClaims.rows.find((claim) => claim.schedule_id === ambiguous.scheduleId);
    assert.ok(ambiguousClaim);
    const ambiguousRecorded = await client.query(recordSql, [
      ambiguousClaim.schedule_id,
      ambiguousClaim.lease_token,
      ambiguousClaim.workflow_version,
      7,
      JSON.stringify(stepResults),
    ]);
    assert.ok(ambiguousRecorded.rows[0].run_id);
    const ambiguousFinish = await client.query(
      "select public.finish_workflow_schedule_claim($1, $2, false, $3) as finished",
      [ambiguousClaim.schedule_id, ambiguousClaim.lease_token, "SCHEDULED_RUN_PERSISTENCE_FAILED"],
    );
    assert.equal(ambiguousFinish.rows[0].finished, true);
    const ambiguousState = await client.query(
      "select failure_count, last_error_code, lease_token, last_run_at is not null as recorded_success from public.workflow_schedules where id = $1",
      [ambiguous.scheduleId],
    );
    assert.equal(ambiguousState.rows[0].failure_count, 0);
    assert.equal(ambiguousState.rows[0].last_error_code, null);
    assert.equal(ambiguousState.rows[0].lease_token, null);
    assert.equal(ambiguousState.rows[0].recorded_success, true);

    await insertWorkflowAndSchedule(client, workspaceId, userId);
    await insertWorkflowAndSchedule(client, workspaceId, userId);
    const [leftClaims, rightClaims] = await Promise.all([
      client.query("select * from public.claim_due_workflow_schedules(1, 300)"),
      secondClient.query("select * from public.claim_due_workflow_schedules(1, 300)"),
    ]);
    const concurrentClaims = [...leftClaims.rows, ...rightClaims.rows];
    assert.equal(concurrentClaims.length, 2);
    assert.equal(new Set(concurrentClaims.map((claim) => claim.schedule_id)).size, 2);

    const retryClaim = concurrentClaims[0];
    const failed = await client.query(
      "select public.finish_workflow_schedule_claim($1, $2, false, $3) as finished",
      [retryClaim.schedule_id, retryClaim.lease_token, "provider payload / secret"],
    );
    assert.equal(failed.rows[0].finished, true);
    const retryState = await client.query(
      "select failure_count, last_error_code, next_run_at > now() as delayed from public.workflow_schedules where id = $1",
      [retryClaim.schedule_id],
    );
    assert.equal(retryState.rows[0].failure_count, 1);
    assert.equal(retryState.rows[0].last_error_code, "SCHEDULED_RUN_FAILED");
    assert.equal(retryState.rows[0].delayed, true);

    await client.query(
      "update public.workflow_schedules set next_run_at = now() - interval '1 minute' where id = $1",
      [retryClaim.schedule_id],
    );
    const reclaimed = await client.query("select * from public.claim_due_workflow_schedules(10, 300)");
    const oldClaim = reclaimed.rows.find((claim) => claim.schedule_id === retryClaim.schedule_id);
    assert.ok(oldClaim, "expired retry occurrence is claimable again");

    await client.query(
      "update public.workflow_schedules set lease_until = now() - interval '1 second' where id = $1",
      [retryClaim.schedule_id],
    );
    const reclaimedAgain = await client.query("select * from public.claim_due_workflow_schedules(10, 300)");
    const newClaim = reclaimedAgain.rows.find((claim) => claim.schedule_id === retryClaim.schedule_id);
    assert.ok(newClaim, "expired lease can be reclaimed");
    assert.notEqual(newClaim.lease_token, oldClaim.lease_token);

    const staleRenewal = await client.query(
      "select public.renew_workflow_schedule_claim($1, $2, 300) as renewed",
      [newClaim.schedule_id, oldClaim.lease_token],
    );
    assert.equal(staleRenewal.rows[0].renewed, false);
    const staleFinishAfterReclaim = await client.query(
      "select public.finish_workflow_schedule_claim($1, $2, true, null) as finished",
      [newClaim.schedule_id, oldClaim.lease_token],
    );
    assert.equal(staleFinishAfterReclaim.rows[0].finished, false);
    const currentRenewal = await client.query(
      "select public.renew_workflow_schedule_claim($1, $2, 300) as renewed",
      [newClaim.schedule_id, newClaim.lease_token],
    );
    assert.equal(currentRenewal.rows[0].renewed, true);
    const finalFinish = await client.query(
      "select public.finish_workflow_schedule_claim($1, $2, true, null) as finished",
      [newClaim.schedule_id, newClaim.lease_token],
    );
    assert.equal(finalFinish.rows[0].finished, true);
  } finally {
    await secondClient.end();
    await client.end();
  }
});
