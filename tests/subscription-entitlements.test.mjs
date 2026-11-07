import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../supabase/migrations/20261107130000_aivanta_subscription_entitlements.sql", import.meta.url), "utf8");
const workflowRoute = await readFile(new URL("../app/api/workflows/route.ts", import.meta.url), "utf8");
const agentRunRoute = await readFile(new URL("../app/api/agents/[agentId]/runs/route.ts", import.meta.url), "utf8");
const aiRoute = await readFile(new URL("../app/api/ai/generate-workflow/route.ts", import.meta.url), "utf8");
const billingRoute = await readFile(new URL("../app/api/billing/route.ts", import.meta.url), "utf8");

test("subscription and usage tables are workspace scoped and RLS protected", () => {
  assert.match(migration, /workspace_subscriptions[\s\S]*workspace_id uuid not null unique references public\.workspaces/);
  assert.match(migration, /alter table public\.workspace_subscriptions enable row level security/);
  assert.match(migration, /alter table public\.workspace_usage enable row level security/);
  assert.match(migration, /private\.is_workspace_member\(p_workspace_id\)/);
});

test("usage RPC rejects unauthenticated and invalid usage requests", () => {
  assert.match(migration, /auth\.uid\(\) is null or not private\.is_workspace_member/);
  assert.match(migration, /p_metric not in \('workflow_created','workflow_execution','ai_credit','agent_run','ai_generation'\)/);
  assert.match(migration, /p_quantity<1 or p_quantity>100/);
});

test("free and paid plan quotas are encoded in server-side metering", () => {
  for (const cap of ["workflow_execution' then 300", "workflow_execution' then 2000", "workflow_execution' then 10000", "workflow_execution' then 50000"]) assert.ok(migration.includes(cap), `missing cap ${cap}`);
});

test("workflow creation, agent runs, and AI draft generation call the usage RPC", () => {
  assert.match(workflowRoute, /consume_workspace_usage[\s\S]*workflow_created[\s\S]*usage\?\.allowed/);
  assert.match(agentRunRoute, /consume_workspace_usage[\s\S]*agent_run[\s\S]*usage\?\.allowed/);
  assert.match(aiRoute, /consume_workspace_usage[\s\S]*ai_generation[\s\S]*usage\?\.allowed/);
});

test("billing endpoint reports blueprint prices without enabling checkout", () => {
  assert.match(billingRoute, /get_workspace_entitlements/);
  assert.match(billingRoute, /monthly:9,annual:90/);
  assert.match(billingRoute, /monthly:29,annual:290/);
  assert.match(billingRoute, /monthly:79,annual:790/);
  assert.match(billingRoute, /checkout_enabled:false/);
});
