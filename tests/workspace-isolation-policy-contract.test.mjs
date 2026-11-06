import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const foundation = readFileSync(
  new URL("../supabase/migrations/20261010180000_aivanta_workspace_workflow_foundation.sql", import.meta.url),
  "utf8",
);
const runHistory = readFileSync(
  new URL("../supabase/migrations/20261010194010_aivanta_workflow_run_history.sql", import.meta.url),
  "utf8",
);
const schedules = readFileSync(
  new URL("../supabase/migrations/20261011090000_scheduled_workflow_foundation.sql", import.meta.url),
  "utf8",
);

test("workspace and workflow tables enable RLS and scope reads to workspace membership", () => {
  for (const table of ["workspaces", "workspace_members", "workflows", "workflow_versions", "audit_events"]) {
    assert.match(
      foundation,
      new RegExp("alter table public\\." + table + " enable row level security", "i"),
      `${table} must have RLS enabled`,
    );
  }

  assert.match(foundation, /using\s*\(\s*private\.is_workspace_member\(id\)\s*\)/i);
  assert.match(foundation, /using\s*\(private\.is_workspace_member\(workspace_id\)\)/i);
  assert.match(foundation, /private\.is_workspace_member\(wf\.workspace_id\)/i);
  assert.match(foundation, /created_by\s*=\s*\(select auth\.uid\(\)\)/i);
  assert.match(foundation, /revoke all on function private\.is_workspace_member\(uuid\) from public,anon/i);
});

test("run history cannot cross workspace boundaries through parent workflow or run references", () => {
  for (const table of ["workflow_runs", "workflow_run_steps"]) {
    assert.match(
      runHistory,
      new RegExp("alter table public\\." + table + " enable row level security", "i"),
      `${table} must have RLS enabled`,
    );
  }

  assert.match(runHistory, /private\.is_workspace_member\(workspace_id\)/i);
  assert.match(runHistory, /w\.id\s*=\s*workflow_runs\.workflow_id[\s\S]*?w\.workspace_id\s*=\s*workflow_runs\.workspace_id/i);
  assert.match(runHistory, /r\.id\s*=\s*workflow_run_steps\.run_id[\s\S]*?r\.workspace_id\s*=\s*workflow_run_steps\.workspace_id/i);
  assert.match(runHistory, /created_by\s*=\s*\(select auth\.uid\(\)\)/i);
  assert.match(runHistory, /mode\s*=\s*'dry_run'/i);
});

test("schedule rows bind workflow and workspace and reserve lease operations for service role", () => {
  assert.match(schedules, /alter table public\.workflow_schedules enable row level security/i);
  assert.match(schedules, /private\.is_workspace_member\(workspace_id\)/i);
  assert.match(schedules, /w\.id\s*=\s*workflow_schedules\.workflow_id[\s\S]*?w\.workspace_id\s*=\s*workflow_schedules\.workspace_id/i);
  assert.match(schedules, /revoke insert, update on public\.workflow_schedules from authenticated/i);
  assert.match(schedules, /grant insert \(workflow_id, workspace_id, interval_minutes, enabled, next_run_at\)/i);
  assert.match(schedules, /grant update \(interval_minutes, enabled, next_run_at\)/i);

  for (const functionName of [
    "claim_due_workflow_schedules",
    "renew_workflow_schedule_claim",
    "finish_workflow_schedule_claim",
  ]) {
    assert.match(
      schedules,
      new RegExp("revoke all on function public\\." + functionName + "\\(", "i"),
      `${functionName} must not be callable by public client roles`,
    );
    assert.match(
      schedules,
      new RegExp("grant execute on function public\\." + functionName + "\\([\\s\\S]*? to service_role", "i"),
      `${functionName} must be service-role only`,
    );
  }
});
