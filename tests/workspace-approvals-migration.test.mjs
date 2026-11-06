import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../supabase/migrations/20261106213345_workspace_provider_operation_approvals.sql", import.meta.url), "utf8");
const rollback = await readFile(new URL("../supabase/rollback/20261106213345_workspace_provider_operation_approvals.down.sql", import.meta.url), "utf8");
const worker = await readFile(new URL("../lib/workflows/durable-worker.ts", import.meta.url), "utf8");
const runner = await readFile(new URL("../nodes/workflow-runner.ts", import.meta.url), "utf8");
const approvalsRoute = await readFile(new URL("../app/api/integrations/workspace/approvals/route.ts", import.meta.url), "utf8");

test("workspace approvals migration is workspace-scoped, private and append-only", () => {
  assert.ok(migration.includes("create table if not exists public.workspace_provider_operation_approvals"));
  assert.ok(migration.includes("workspace_id uuid not null references public.workspaces(id) on delete cascade"));
  assert.ok(migration.includes("alter table public.workspace_provider_operation_approvals enable row level security"));
  assert.ok(migration.includes("revoke all on table public.workspace_provider_operation_approvals from public, anon, authenticated"));
  assert.ok(migration.includes("revoke update, delete, truncate on table public.workspace_provider_operation_approvals from service_role"));
  assert.ok(migration.includes("grant ¶»§q«^