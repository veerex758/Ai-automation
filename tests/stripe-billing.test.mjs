import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const migration=await readFile(new URL("../supabase/migrations/20261114140000_aivanta_billing_lifecycle_stripe.sql",import.meta.url),"utf8");
const lifecycle=await readFile(new URL("../supabase/migrations/20261114150000_aivanta_subscription_plan_lifecycle.sql",import.meta.url),"utf8");
const checkout=await readFile(new URL("../app/api/billing/stripe/checkout/route.ts",import.meta.url),"utf8");
const webhook=await readFile(new URL("../app/api/billing/stripe/webhook/route.ts",import.meta.url),"utf8");
const billing=await readFile(new URL("../app/api/billing/route.ts",import.meta.url),"utf8");
test("Stripe payment ledger is enabled without exposing payment writes to clients",()=>{
 assert.ok(migration.includes("provider in ('paystack','stripe')"));
 assert.ok(migration.includes("provider_transaction_ref"));
});
test("Stripe checkout validates configured one-time prices against Aivanta plan amounts",()=>{
 assert.ok(checkout.includes("stripe.prices.retrieve"));
 assert.ok(checkout.includes("price.unit_amount!==plan.amountMinor"));
 assert.ok(checkout.includes('price.type!=="one_time"'));
 assert.ok(checkout.includes('provider:"stripe"'));
});
test("Stripe webhook verifies signatures and settles only matching paid workspace payments",()=>{
 assert.ok(webhook.includes("constructEvent"));
 assert.ok(webhook.includes('session.payment_status!=="paid"'));
 assert.ok(webhook.includes("session.amount_total!==payment.amount_minor"));
 assert.ok(webhook.includes("settle_stripe_workspace_payment"));
});
test("billing endpoint exposes Stripe readiness only for configured plan prices",()=>{
 assert.ok(billing.includes("stripe_checkout_enabled"));
 assert.ok(billing.includes("AIVANTA_STRIPE_PRICE_"));
});
test("Paystack and Stripe settlement share stale-payment protection and scheduled downgrade rules",()=>{
 assert.ok(lifecycle.includes("settle_workspace_payment"));
 assert.ok(lifecycle.includes("stale_payment"));
 assert.ok(lifecycle.includes("scheduled_downgrade"));
 assert.ok(lifecycle.includes("pending_plan_effective_at"));
});
