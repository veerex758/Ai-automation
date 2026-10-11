import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(
  new URL("../app/api/internal/scheduler/route.ts", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL("../supabase/migrations/20261011091000_scheduled_workflow_dispatcher.sql", import.meta.url),
  "utf8",
);

test("protects the scheduler endpoint with a timing-safe server secret check", () => {
  assert.ok(route.includes("timingSafeEqual"));
  assert.ok(route.includes("process.env.CRON_SECRET"));
  assert.ok(route.includes('request.headers.get("authorization")'));
  assert.ok(route.includes("SUPABASE_SECRET_KEY"));
  assert.ok(route.includes("SUPABASE_SERVICE_ROLE_KEY"));
});

test("limits the first dispatcher to side-effect-free dry-runs", () => {
  assert.ok(route.includes("const claimLimit = 10"));
  assert.ok(route.includes("const leaseSeconds = 300"));
  assert.ok(route.includes("runDryRun"));
  assert.ok(!route.includes("sendResendEmail"));
  assert.ok(!route.includes("fetch("));
  assert.ok(route.includes('result.sideEffectsPerformed !== false'));
});

test("claims, persists, and finalizes schedules using lease-bound RPCs", () => {
  assert.ok(route.includes('"claim_due_workflow_schedules"'));
  assert.ok(route.includes('"record_scheduled_workflow_run"'));
  assert.ok(route.includes('"finish_workflow_schedule_claim"'));
  assert.ok(route.includes("p_lease_token: claim.lease_token"));
  assert.ok(route.includes("INVALID_WORKFLOW_DEFINITION"));
  assert.ok(route.includes("SCHEDULED_RUN_PERSISTENCE_FAILED"));
});

test("persists scheduled runs atomically and idempotently for the active lease", () => {
  assert.ok(migration.includes("for update of s"));
  assert.ok(migration.includes("s.lease_token = p_lease_token"));
  assert.ok(migration.includes("s.lease_until > now()"));
  assert.ok(migration.includes('drop policy if exists "workspace members can update workflow schedules"'));
  assert.ok(migration.includes("and lease_token is null"));
  assert.ok(migration.includes("schedule_idempotency_key"));
  assert.ok(migration.includes("insert into public.workflow_runs"));
  assert.ok(migration.includes("insert into public.workflow_run_steps"));
  assert.ok(migration.includes("grant execute on function public.record_scheduled_workflow_run(uuid, uuid, integer, integer, jsonb)"));
  assert.ok(migration.includes("to service_role"));
  assert.ok(migration.includes("from public, anon, authenticated"));
});

test("rejects malformed or reordered step results before writing history", () => {
  assert.ok(migration.includes("workflow_node.ordinality = step_position"));
  assert.ok(migration.includes("workflow_node.value->>'id' = step_id_value"));
  assert.ok(migration.includes("step_status_value is null or step_status_value not in ('simulated', 'skipped')"));
  assert.ok(migration.includes("pg_catalog.octet_length(step_result_value::text) > 8000"));
});
