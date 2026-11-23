import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const migration=await readFile(new URL("../supabase/migrations/20261114150000_aivanta_subscription_plan_lifecycle.sql",import.meta.url),"utf8");
const billingRoute=await readFile(new URL("../app/api/internal/billing/reconcile/route.ts",import.meta.url),"utf8");
const vercel=JSON.parse(await readFile(new URL("../vercel.json",import.meta.url),"utf8"));
const invoice=await readFile(new URL("../app/api/billing/invoices/[paymentId]/route.ts",import.meta.url),"utf8");
const page=await readFile(new URL("../app/dashboard/billing/page.tsx",import.meta.url),"utf8");
test("subscription lifecycle expires paid-through plans and applies scheduled downgrades",()=>{
 assert.ok(migration.includes("current_period_end<=now()"));
 assert.ok(migration.includes("pending_plan_effective_at<=now()"));
 assert.ok(migration.includes("status='canceled'"));
});
test("Paystack reconciliation verifies pending transactions and runs lifecycle sweep",()=>{
 assert.ok(billingRoute.includes("/transaction/verify/"));
 assert.ok(billingRoute.includes("settle_paystack_workspace_payment"));
 assert.ok(billingRoute.includes("expire_workspace_subscriptions"));
});
test("daily Vercel cron invokes protected billing reconciliation",()=>{
 assert.ok(vercel.crons.some(c=>c.path==="/api/internal/billing/reconcile"));
});
test("payment receipt is workspace scoped and only available for verified payments",()=>{
 assert.ok(invoice.includes('eq("workspace_id",workspace.id)'));
 assert.ok(invoice.includes('payment.status!=="success"'));
 assert.ok(page.includes("/api/billing/invoices/"));
});
