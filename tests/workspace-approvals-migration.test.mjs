import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../supabase/migrations/20261106213345_workspace_provider_operation_approvals.sql", import.meta.url), "utf8");
const rollback = await readFile(new URL("../supabase/rollback/20261106213345_workspace_provider_operation_approvals.down.sql", import.meta.url), "utf8");
const worker = await readFile(new URL("../lib/workflows/durable-worker.ts", import.meta.url), "utf8");
const runner = await readFile(new URL("../nodes/workflow-runner.ts", import.meta.url), "utf8");
const approvalsRoute = await readFile(new URL("../app/api/integrations/workspace/approvals/route.ts", import.meta.url), "utf8");

test("workspace approval migration is workspace-scoped, private and append-only", () => {
  assert.match(migration, /create table if not exists public\.workspace_provider_operation_approvals/);
  assert.match(migration, /workspace_id uuid not null references public\.workspaces/);
  assert.match(migration, /alter table public\.workspace_provider_operation_approvals enable row level security/);
  assert.match(migration, /revoke all on table public\.workspace_provider_operation_approvals from public, anon, authenticated/);
  assert.match(migration, /revoke update, delete, truncate on table public\.workspace_provider_operation_approvals from service_role/);
  assert.match(migration, /grant select, insert on table public\.workspace_provider_operation_approvals to service_role/);
  assert.match(rollback, /drop table if exists public\.workspace_provider_operation_approvals/);
});

test("worker fails closed unless the latest workspace decision explicitly approves the operation", () => {
  assert.match(worker, /workspace_provider_operation_approvals/);
  assert.match(worker, /WORKSPACE_PROVIDER_OPERATION_NOT_APPROVED/);
  assert.match(worker, /WORKSPACE_OPERATION_APPROVAL_LOOKUP_FAILED/);
  assert.match(worker, /order\("decided_at", \{ ascending: false \}\)/);
  assert.match(runner, /authorizeOperation\?\./);
});

test("approval API authenticates users, requires workspace admins and appends immutable decisions", () => {
  assert.match(approvalsRoute, /supabase\.auth\.getUser/);
  assert.match(approvalsRoute, /workspace_members/);
  assert.match(approvalsRoute, /\["owner", "admin"\]/);
  assert.match(approvalsRoute, /\.insert\(/);
  assert.match(approvalsRoute, /decision/);
  assert.match(approvalsRoute, /private, no-store/);
});

test("approval API bounds raw request bytes before JSON parsing", () => {
  assert.match(approvalsRoute, /content-length/);
  assert.match(approvalsRoute, /request\.text\(\)/);
  assert.match(approvalsRoute, /Buffer\.byteLength\(rawBody, "utf8"\) > 8 \* 1024/);
  assert.match(approvalsRoute, /Approval request exceeds the 8 KB limit/);
});

test("approval reads and writes reject cross-origin browser requests", () => {
  assert.match(approvalsRoute, /export async function GET\(request: NextRequest\)/);
  assert.equal((approvalsRoute.match(/Cross-origin request rejected/g) ?? []).length, 2);
  assert.match(approvalsRoute, /request\.headers\.get\("origin"\)/);
});
