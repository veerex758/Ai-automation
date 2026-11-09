import test from "node:test";import assert from "node:assert/strict";import{readFileSync}from"node:fs";
const checkout=readFileSync(new URL("../app/api/marketplace/checkout/route.ts",import.meta.url),"utf8");
const webhook=readFileSync(new URL("../app/api/marketplace/webhooks/[provider]/route.ts",import.meta.url),"utf8");
const report=readFileSync(new URL("../app/api/marketplace/admin/settlement/route.ts",import.meta.url),"utf8");
const migration=readFileSync(new URL("../supabase/migrations/20261107160000_aivanta_marketplace_settlement_payout_eligibility.sql",import.meta.url),"utf8");
test("checkout route is authenticated, gated, USD-only, version-approved and idempotent",()=>{
 for(const x of ["AIVANTA_MARKETPLACE_CHECKOUT_ENABLED","session.auth.getUser()","buyerEmail:user.email","status!==\"published\"","verification_status!==\"approved\"","provider.createCheckout","provider_checkout_id","idempotencyKey:\"aivanta-\""])assert.ok(checkout.includes(x),x);
 assert.ok(checkout.includes("buyerEmail:user.email"));assert.doesNotMatch(checkout,/value\.buyerEmail/);\n assert.ok(checkout.includes("status:\"pending\""));assert.ok(!checkout.includes("status:\"paid\""));
});
test("webhook route dispatches provider adapters into service-only atomic RPCs",()=>{
 for(const x of ["req.arrayBuffer()","processMarketplaceWebhook","marketplace_finalize_payment","marketplace_reverse_payment","SUPABASE_SERVICE_ROLE_KEY","providerId!==\"paystack\"&&providerId!==\"stripe\""])assert.ok(webhook.includes(x),x);
 assert.ok(!webhook.includes("auth.getUser"));
});
test("settlement report is reviewer-gated and explicitly cannot transfer funds",()=>{
 for(const x of ["AIVANTA_MARKETPLACE_REVIEWER_IDS","marketplace_financial_reconciliation","marketplace_creator_payout_eligibility","transferEnabled:false","minimumPayoutMinor:5000"])assert.ok(report.includes(x),x);
});
test("payout eligibility requires creator verification, payout KYC, destination, reconciliation and minimum balance",()=>{
 for(const x of ["payout_status","'verified'","payout_account_ref","reconciliation_clear","marketplace_creator_payout_eligibility","below_minimum_payout","settlement_reconciliation_required","greatest(1,p_minimum_minor)","revoke all on function public.marketplace_creator_payout_eligibility(bigint) from public,anon,authenticated","grant execute on function public.marketplace_creator_payout_eligibility(bigint) to service_role"])assert.ok(migration.includes(x),x);
 assert.match(migration,/does not initiate transfers/i);
});
