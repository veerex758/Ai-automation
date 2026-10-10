import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/20261010203630_harden_workflow_run_step_inserts.sql", import.meta.url),
  "utf8",
);

test("replaces the broader run-step insert policy", () => {
  assert.match(migration, /drop policy if exists "members can create workflow run steps"/);
  assert.match(migration, /create policy "members can create their own workflow run steps"/);
});

test("scopes inserted run steps to the authenticated run creator and workspace", () => {
  assert.match(migration, /r\.created_by = \(select auth\.uid\(\)\)/);
  assert.match(migration, /r\.workspace_id = workflow_run_steps\.workspace_id/);
  assert.match(migration, /r\.workflow_id is not null/);
});

test("allows only dry-run step statuses for completed dry-runs", () => {
  assert.match(migration, /r\.mode = 'dry_run' and r\.status in \('succeeded', 'failed'\)/);
  assert.match(migration, /workflow_run_steps\.status in \('simulated', 'skipped', 'failed'\)/);
});

test("allows live step statuses only while the owned live run is running", () => {
  assert.match(migration, /r\.mode = 'live' and r\.status = 'running'/);
  assert.match(migration, /workflow_run_steps\.status in \('simulated', 'skipped', 'executed', 'failed'\)/);
});
