import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../supabase/migrations/20261114120000_aivanta_workspace_subscription_cancellation.sql", import.meta.url), "utf8");
const route = await readFile(new URL("../app/api/billing/cancel/route.ts", import.meta.url), "utf8");

test("workspace subscription cancellation is authorized by owner/admin and row-locked", () => {
  assert.match(migration, /auth\.uid\(\)/);
  assert.match(migration, /workspace_members/);
  assert.match(migration, /v_role not in \('owner', 'admin'\)/);
  assert.match(migration, /for update/);
  assert.match(migration, /revoke all on function public\.request_workspace_subscription_cancellation\(uuid\) from public, anon/);
  assert.match(migration, /grant execute on function public\.request_workspace_subscription_cancellation\(uuid\) to authenticated/);
});

test("prepaid Paystack cancellation preserves access until paid-through date", () => {
  assert.match(migration, /cancel_at_period_end = true/);
  assert.match(migration, /current_period_end/);
  assert.match(migration, /status = 'canceled'/);
  assert.match(migration, /no_active_paid_subscription/);
});

test("cancellation API requires an authenticated workspace and delegates authorization to the database", () => {
  assert.match(route, /auth\.getUser\(\)/);
  assert.match(route, /getOrCreateDefaultWorkspace/);
  assert.match(route, /request_workspace_subscription_cancellation/);
  assert.match(route, /status: 403/);
  assert.match(route, /status: 409/);
});
