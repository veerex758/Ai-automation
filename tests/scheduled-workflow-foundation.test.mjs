import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/20261011090000_scheduled_workflow_foundation.sql", import.meta.url),
  "utf8",
);

test("limits schedules to a bounded interval and workspace-owned workflow", () => {
  assert.match(migration, /interval_minutes between 15 and 10080/i);
  assert.match(migration, /unique \(workflow_id, workspace_id\)/i);
  assert.match(migration, /w.workspace_id = workflow_schedules.workspace_id/i);
  assert.match(migration, /alter table public.workflow_schedules enable row level security/i);
});

test("claims due active schedule-trigger workflows with row locks and leases", () => {
  assert.match(migration, /for update of s skip locked/i);
  assert.match(migration, /lease_until is null or s.lease_until <= now()/i);
  assert.match(migration, /w.status = 'active'/i);
  assert.match(migration, /settings'->>'event' = 'schedule'/i);
  assert.match(migration, /gen_random_uuid\(\)/i);
});

test("restricts scheduler RPCs to service role", () => {
  assert.match(migration, /revoke all on function public.claim_due_workflow_schedules\(integer, integer\) from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public.claim_due_workflow_schedules\(integer, integer\) to service_role/i);
  assert.match(migration, /grant execute on function public.finish_workflow_schedule_claim\(uuid, uuid, boolean, text\) to service_role/i);
});

test("requires the active lease token before finishing and sanitizes failure codes", () => {
  assert.match(migration, /lease_token = p_lease_token/i);
  assert.match(migration, /lease_until > now()/i);
  assert.match(migration, /safe_error_code/i);
  assert.match(migration, /SCHEDULED_RUN_FAILED/i);
  assert.match(migration, /least\(60, 5 \* power\(2, least\(failure_count, 4\)\)::integer\)/i);
});

test("advances successful schedules without rapid catch-up bursts", () => {
  assert.match(migration, /greatest\(/i);
  assert.match(migration, /now() + make_interval(mins => current_schedule.interval_minutes)/i);
});

test("prevents authenticated users from modifying worker lease state", () => {
  assert.match(migration, /revoke insert, update on public\.workflow_schedules from authenticated/i);
  assert.match(migration, /grant update \(interval_minutes, enabled, next_run_at\)/i);
  assert.doesNotMatch(migration, /grant update on public\.workflow_schedules to authenticated/i);
});
