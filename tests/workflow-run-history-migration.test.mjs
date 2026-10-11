import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/20261010194010_aivanta_workflow_run_history.sql", import.meta.url),
  "utf8",
);

test("creates run history tables before dependent execution migrations", () => {
  assert.match(migration, /create table if not exists public\.workflow_runs/i);
  assert.match(migration, /create table if not exists public\.workflow_run_steps/i);
  assert.match(migration, /workflow_version integer not null check \(workflow_version > 0\)/i);
  assert.match(migration, /unique \(run_id, step_id\)/i);
});

test("starts with dry-run-only statuses before the live execution migration", () => {
  assert.match(migration, /mode text not null default 'dry_run' check \(mode = 'dry_run'\)/i);
  assert.match(migration, /status text not null check \(status in \('succeeded', 'failed'\)\)/i);
  assert.match(migration, /status text not null check \(status in \('simulated', 'skipped', 'failed'\)\)/i);
});

test("protects run history with workspace membership RLS policies", () => {
  assert.match(migration, /alter table public\.workflow_runs enable row level security/i);
  assert.match(migration, /alter table public\.workflow_run_steps enable row level security/i);
  assert.match(migration, /private\.is_workspace_member\(workspace_id\)/i);
  assert.match(migration, /created_by = \(select auth\.uid\(\)\)/i);
  assert.match(migration, /w\.workspace_id = workflow_runs\.workspace_id/i);
});

test("adds indexes for run history and ordered step retrieval", () => {
  assert.match(migration, /workflow_runs_workflow_created_idx/i);
  assert.match(migration, /workflow_runs_workspace_created_idx/i);
  assert.match(migration, /workflow_run_steps_run_position_idx/i);
  assert.match(migration, /workflow_run_steps_workspace_idx/i);
});
