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

test("usage RPC rej¶»§q«^