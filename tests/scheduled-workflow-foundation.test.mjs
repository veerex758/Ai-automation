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
  assert.match(migration, /lease_token is null\) = \(lease_until is null/i);
  assert.match(migration, /failure_count integer not null default 0 check \(failure_count >= 0\)/i);
});

test("claims only due, enabled, active schedule-trigger workflows under row locks", () => {
  assert.match(migration, /s.enabled = true/i);
  assert.match(migration, /s.next_run_at <= now\(\)/i);
  assert.match(migration, /for update of s skip locked/i);
  assert.match(migration, /lease_until is null or s.lease_until <= now\(\)/i);
  assert.match(migration, /w.status = 'active'/i);
  assert.match(migration, /jsonb_typeof\(w.definition->'nodes'\) = 'array'/i);
  assert.match(migration, /settings'->>'event' = 'schedule'/i);
  assert.match(migration, /gen_random_uuid\(\)/i);
});

test("rejects unsafe claim batch sizes and lease durations", () => {
  assert.match(migration, /if p_limit < 1 or p_limit > 50 then/i);
  assert.match(migration, /if p_lease_seconds < 30 or p_lease_seconds > 900 then/i);
  assert.match(migration, /make_interval\(secs => p_lease_seconds\)/i);
});

test("keeps security-definer scheduler RPCs isolated and service-role-only", () => {
  const functions = migration.split("create or replace function public.");
  const claimFunction = functions.find((part) => part.startsWith("claim_due_workflow_schedules("));
  const finishFunction = functions.find((part) => part.startsWith("finish_workflow_schedule_claim("));
  assert.ok(claimFunction, "claim RPC exists");
  assert.ok(finishFunction, "finish RPC exists");
  assert.match(claimFunction, /security definer\s+set search_path = ''/i);
  assert.match(finishFunction, /security definer\s+set search_path = ''/i);
  assert.ok(migration.includes("revoke all on function public.claim_due_workflow_schedules(integer, integer) from public, anon, authenticated"));
  assert.ok(migration.includes("revoke all on function public.finish_workflow_schedule_claim(uuid, uuid, boolean, text) from public, anon, authenticated"));
  assert.ok(migration.includes("grant execute on function public.claim_due_workflow_schedules(integer, integer) to service_role"));
  assert.ok(migration.includes("grant execute on function public.finish_workflow_schedule_claim(uuid, uuid, boolean, text) to service_role"));
});

test("renews only a current unexpired lease and keeps renewal worker-only", () => {
  const renewalStart = migration.indexOf("create or replace function public.renew_workflow_schedule_claim(");
  const delimiter = "$renew_workflow_schedule_claim$";
  const renewalEnd = migration.indexOf(delimiter + ";", renewalStart);
  assert.ok(renewalStart >= 0, "lease renewal RPC exists");
  assert.ok(renewalEnd > renewalStart, "lease renewal RPC has a valid dollar-quoted body");
  const renewalFunction = migration.slice(renewalStart, renewalEnd);
  assert.ok(renewalFunction.includes("as " + delimiter), "lease renewal body uses valid dollar quoting");
  assert.ok(renewalFunction.includes("security definer"));
  assert.ok(renewalFunction.includes("set search_path = ''"));
  assert.ok(renewalFunction.includes("p_lease_seconds < 30 or p_lease_seconds > 900"));
  assert.ok(renewalFunction.includes("lease_token = p_lease_token"));
  assert.ok(renewalFunction.includes("lease_until > now()"));
  assert.ok(renewalFunction.includes("return found"));
  assert.ok(migration.includes("revoke all on function public.renew_workflow_schedule_claim(uuid, uuid, integer) from public, anon, authenticated"));
  assert.ok(migration.includes("grant execute on function public.renew_workflow_schedule_claim(uuid, uuid, integer) to service_role"));
});

test("requires the current unexpired lease token before finishing a claim", () => {
  assert.match(migration, /lease_token = p_lease_token/i);
  assert.match(migration, /lease_until > now\(\)/i);
  assert.match(migration, /if not found then\s+return false/i);
});

test("sanitizes failure codes and applies bounded retry backoff", () => {
  assert.match(migration, /safe_error_code/i);
  assert.match(migration, /SCHEDULED_RUN_FAILED/i);
  assert.match(migration, /least\(60, 5 \* power\(2, least\(failure_count, 4\)\)::integer\)/i);
  assert.match(migration, /last_error_code = safe_error_code/i);
});

test("advances successful schedules without rapid catch-up bursts", () => {
  assert.match(migration, /greatest\(/i);
  assert.ok(migration.includes("current_schedule.next_run_at + make_interval(mins => current_schedule.interval_minutes)"));
  assert.ok(migration.includes("now() + make_interval(mins => current_schedule.interval_minutes)"));
  assert.match(migration, /failure_count = 0/i);
  assert.match(migration, /lease_token = null,\s+lease_until = null/i);
});

test("prevents authenticated users from modifying worker-controlled state", () => {
  assert.match(migration, /revoke all on public\.workflow_schedules from anon, public/i);
  assert.match(migration, /revoke insert, update on public\.workflow_schedules from authenticated/i);
  assert.match(migration, /grant insert \(workflow_id, workspace_id, interval_minutes, enabled, next_run_at\)/i);
  assert.match(migration, /grant update \(interval_minutes, enabled, next_run_at\)/i);
  assert.doesNotMatch(migration, /grant update on public\.workflow_schedules to authenticated/i);
});
