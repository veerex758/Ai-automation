import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../supabase/migrations/20261107130000_aivanta_subscription_entitlements.sql", import.meta.url), "utf8");
const hardeningMigration = await readFile(new URL("../supabase/migrations/20261107131500_aivanta_subscription_entitlement_hardening.sql", import.meta.url), "utf8");
const workflowRoute = await readFile(new URL("../app/api/workflows/route.ts", import.meta.url), "utf8");
const agentRunRoute = await readFile(new URL("../app/api/agents/[agentId]/runs/route.ts", import.meta.url), "utf8");
const aiRoute = await readFile(new URL("../app/api/ai/generate-workflow/route.ts", import.meta.url), "utf8");
const registryRunRoute = await readFile(new URL("../app/api/workflows/[workflowId]/registry-run/route.ts", import.meta.url), "utf8");
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

test("active workflow caps are enforced transactionally and AI usage consumes AI credits", () => {
  assert.match(hardeningMigration, /pg_advisory_xact_lock/);
  assert.match(hardeningMigration, /workflows_enforce_active_entitlement/);
  assert.match(hardeningMigration, /AIVANTA_WORKFLOW_LIMIT_REACHED/);
  assert.match(workflowRoute, /AIVANTA_WORKFLOW_LIMIT_REACHED/);
  assert.match(agentRunRoute, /p_metric: "ai_credit".*feature: "agent_run"/);
  assert.match(aiRoute, /p_metric: "ai_credit".*workflow_draft_generation/);
  assert.match(registryRunRoute, /p_metric: "workflow_execution"/);
  assert.match(registryRunRoute, /The blueprint defines one workflow run as one execution/);
  assert.ok(hardeningMigration.includes("enterprise"));
  assert.ok(hardeningMigration.includes("custom_execution_limit"));
});

test("enterprise plan custom limits render without numeric formatting errors", async () => {
  const billingPage = await readFile(new URL("../app/dashboard/billing/page.tsx", import.meta.url), "utf8");
  assert.match(billingPage, /workflow_execution==null\?"Custom executions"/);
  assert.match(billingPage, /ai_credit==null\?"Custom AI credits"/);
});

test("billing endpoint reports blueprint prices without enabling checkout", () => {
  assert.match(billingRoute, /get_workspace_entitlements/);
  assert.match(billingRoute, /monthly:9,annual:90/);
  assert.match(billingRoute, /monthly:29,annual:290/);
  assert.match(billingRoute, /monthly:79,annual:790/);
  assert.match(billingRoute, /checkout_enabled:false/);
});
