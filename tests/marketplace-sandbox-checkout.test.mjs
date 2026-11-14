import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const sql=readFileSync(new URL("../supabase/migrations/20261114150000_aivanta_marketplace_sandbox_checkout.sql",import.meta.url),"utf8");
const route=readFileSync(new URL("../app/api/marketplace/sandbox-checkout/route.ts",import.meta.url),"utf8");
test("sandbox checkout is gated and isolated from real payment records",()=>{
 assert.match(route,/AIVANTA_MARKETPLACE_SANDBOX_CHECKOUT_ENABLED/);
 assert.match(sql,/marketplace_sandbox_checkout_sessions/);
 assert.match(sql,/unique\(buyer_user_id,idempotency_key\)/);
 assert.match(sql,/sandbox_only',true/);
 assert.match(sql,/entitlement_created',false/);
 assert.doesNotMatch(sql,/insert into public\.marketplace_purchases/i);
 assert.doesNotMatch(sql,/marketplace_finalize_payment/);
});
test("sandbox session completion is owner-bound, replay-safe, and creates no entitlement or ledger",()=>{
 assert.match(sql,/buyer_user_id=uid and status='pending'/);
 assert.match(sql,/s\.status<>'simulated_success'/);
 assert.match(sql,/real_payment',false/);
 assert.match(sql,/financial_ledger_written',false/);
 assert.match(route,/action==="complete"/);
 assert.match(route,/No real payment or entitlement was created/);
});
test("sandbox checkout requires published product and exact approved current version",()=>{
 assert.match(sql,/status='published'/);
 assert.match(sql,/p\.current_version_id/);
 assert.match(sql,/verification_status='approved'/);
 assert.match(sql,/p\.pricing_type='free'/);
});
