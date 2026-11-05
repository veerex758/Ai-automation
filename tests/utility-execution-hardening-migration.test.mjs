import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(new URL("../supabase/migrations/20261105120000_aivanta_utility_execution_hardening.sql", import.meta.url), "utf8");

test("utility hardening migration adds a workspace-scoped atomic sliding-window limiter", () => {
  assert.match(sql, /create table if not exists public\.execution_rate_limit_hits/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /hit_at <= now_at - \(p_window_ms \* interval '1 millisecond'\)/i);
  assert.match(sql, /grant execute on function public\.consume_execution_rate_limit\(uuid,text,integer,integer\) to service_role/i);
  assert.match(sql, /revoke all on function public\.consume_execution_rate_limit\(uuid,text,integer,integer\) from public,anon,authenticated/i);
});

test("utility hardening migration persists deduplicated, lease-checked workflow error events", () => {
  assert.match(sql, /create table if not exists public\.execution_error_events/i);
  assert.match(sql, /unique\(job_id,step_id,attempt\)/i);
  assert.match(sql, /where id=p_job_id and status='running' and lease_token=p_lease_token and lease_until > now\(\) for update/i);
  assert.match(sql, /grant execute on function public\.record_execution_error_event\(uuid,uuid,text,text,text,integer\) to service_role/i);
  assert.match(sql, /revoke all on public\.execution_error_events from public,anon,authenticated/i);
});


test("Error Trigger dispatch is same-workspace, active-only, idempotent and live-gated", () => {
  assert.match(sql, /create or replace function public\.dispatch_execution_error_event/i);
  assert.match(sql, /w\.workspace_id = event_row\.workspace_id/);
  assert.match(sql, /w\.status = 'active'/);
  assert.match(sql, /w\.definition->'steps'->0->>'nodeId' = 'error_trigger'/);
  assert.match(sql, /'error:' \|\| event_row\.id::text \|\| ':' \|\| workflow_row\.id::text/);
  assert.match(sql, /source_mode <> 'live'/);
  assert.match(sql, /source_payload->>'source' = 'error_trigger'/);
  assert.match(sql, /record_and_dispatch_execution_error_event/);
});
