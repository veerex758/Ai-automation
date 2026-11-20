import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../supabase/migrations/20261107130000_aivanta_subscription_entitlements.sql", import.meta.url), "utf8");
const hardeningMigration = await readFile(new URL("../supabase/migrations/20261107131500_aivanta_subscription_entitlement_hardening.sql", import.meta.url), "utf8");
const workflowRoute = await readFile(new URL("../app/api/workflows/route.ts", import.meta.url), "utf8");
const agentRunRoute = await readFile(new URL("../app/api/agents/[agentId]/runs/route.ts", import.meta.url), "utf8");
const aiRoute = await readFile(new URL("../app/api/ai/generate-workflow/route.ts", import.meta.url), "utf8");
const workflowRunRoute = await readFile(new URL("../app/api/workflows/[workflowId]/runs/route.ts", import.meta.url), "utf8");
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

test("active workflow caps are enforced and AI credit is charged only for validated drafts", () => {
  assert.match(hardeningMigration, /pg_advisory_xact_lock/);
  assert.match(hardeningMigration, /workflows_enforce_active_entitlement/);
  assert.match(hardeningMigration, /AIVANTA_WORKFLOW_LIMIT_REACHED/);
  assert.match(workflowRoute, /AIVANTA_WORKFLOW_LIMIT_REACHED/);
  assert.match(agentRunRoute, /p_metric: "ai_credit".*feature: "agent_run"/);

  const preflight = aiRoute.indexOf('supabase.rpc("get_workspace_entitlements"');
  const generation = aiRoute.indexOf("await generateWorkflow(");
  const graphValidation = aiRoute.indexOf("validateRegisteredSteps(rebuilt)");
  const creditMetering = aiRoute.indexOf('supabase.rpc("consume_workspace_usage"');
  const successLog = aiRoute.indexOf('outcome: "success"');
  assert.ok(preflight >= 0 && generation > preflight && graphValidation > generation);
  assert.ok(creditMetering > graphValidation && successLog > creditMetering);
  assert.match(aiRoute, /p_metric: "ai_credit"/);
  assert.match(aiRoute, /feature: "workflow_draft_generation"/);
  assert.doesNotMatch(aiRoute.slice(0, generation), /consume_workspace_usage/);
  assert.match(workflowRunRoute, /p_metric: "workflow_execution"/);
  assert.match(workflowRunRoute, /One workflow run is one execution, including a safe dry-run/);
  assert.ok(hardeningMigration.includes("enterprise"));
  assert.ok(hardeningMigration.includes("custom_execution_limit"));
});

test("enterprise plan custom limits render without numeric formatting errors", async () => {
  const billingPage = await readFile(new URL("../app/dashboard/billing/page.tsx", import.meta.url), "utf8");
  assert.match(billingPage, /workflow_execution==null\?"Custom executions"/);
  assert.match(billingPage, /ai_credit==null\?"Custom AI credits"/);
});

test("billing endpoint reports blueprint prices and gates checkout on explicit server configuration", () => {
  assert.match(billingRoute, /get_workspace_entitlements/);
  assert.match(billingRoute, /monthly:9,annual:90/);
  assert.match(billingRoute, /monthly:29,annual:290/);
  assert.match(billingRoute, /monthly:79,annual:790/);
  assert.ok(billingRoute.includes("configuredPlans.some(p=>p.checkout.length)"));
  assert.ok(billingRoute.includes("p.checkout.map(slug=>{const plan=getPaidPlan(slug)"));
});

const aiCreditWalletMigration = await readFile(new URL("../supabase/migrations/20261107140000_aivanta_ai_credit_wallet.sql", import.meta.url), "utf8");

test("AI credit top-ups use a separate workspace wallet and immutable ledger", () => {
  assert.match(aiCreditWalletMigration, /create table if not exists public\.workspace_ai_credit_wallets/);
  assert.match(aiCreditWalletMigration, /create table if not exists public\.workspace_ai_credit_transactions/);
  assert.match(aiCreditWalletMigration, /alter table public\.workspace_ai_credit_wallets enable row level security/);
  assert.match(aiCreditWalletMigration, /alter table public\.workspace_ai_credit_transactions enable row level security/);
  assert.match(aiCreditWalletMigration, /revoke all on public\.workspace_ai_credit_transactions from anon, authenticated, service_role/);
  assert.match(aiCreditWalletMigration, /grant select on public\.workspace_ai_credit_transactions to authenticated/);
});

test("AI credit top-ups are provider-neutral, service-role-only, and idempotent", () => {
  for (const provider of ["paddle", "stripe", "paystack", "flutterwave"]) {
    assert.ok(aiCreditWalletMigration.includes("'" + provider + "'"), "missing provider " + provider);
  }
  assert.ok(aiCreditWalletMigration.includes("coalesce(auth.role(), '') <> 'service_role'"));
  assert.match(aiCreditWalletMigration, /grant execute on function public\.grant_workspace_ai_credit_topup[\s\S]*to service_role/i);
  assert.match(aiCreditWalletMigration, /on conflict \(workspace_id, idempotency_key\) do nothing/);
  assert.match(aiCreditWalletMigration, /payment reference was already recorded with different top-up details/);
  assert.match(aiCreditWalletMigration, /balance = balance \+ p_credits/);
});
