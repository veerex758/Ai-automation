import test from "node:test";import assert from "node:assert/strict";import {readFile} from "node:fs/promises";
const migration=await readFile(new URL("../supabase/migrations/20261109100000_aivanta_paystack_payment_ledger.sql",import.meta.url),"utf8");
const checkout=await readFile(new URL("../app/api/billing/checkout/route.ts",import.meta.url),"utf8");
const verify=await readFile(new URL("../app/api/billing/verify/route.ts",import.meta.url),"utf8");
const webhook=await readFile(new URL("../app/api/billing/webhook/route.ts",import.meta.url),"utf8");
const billing=await readFile(new URL("../app/api/billing/route.ts",import.meta.url),"utf8");
const page=await readFile(new URL("../app/dashboard/billing/page.tsx",import.meta.url),"utf8");
test("Paystack migration keeps subscription table Phase-5-owned and adds RLS payment/event ledgers",()=>{assert.match(migration,/create table if not exists public\.billing_payments/);assert.match(migration,/create table if not exists public\.billing_webhook_events/);assert.match(migration,/alter table public\.billing_payments enable row level security/);assert.match(migration,/private\.is_workspace_member\(workspace_id\)/);assert.doesNotMatch(migration,/create table if not exists public\.workspace_subscriptions/);});
test("settlement RPC is service-role-only, idempotent, and atomically updates payment + Pro entitlement",()=>{assert.match(migration,/auth\.role\(\) <> 'service_role'/);assert.match(migration,/for update/);assert.match(migration,/st¶»§q«^