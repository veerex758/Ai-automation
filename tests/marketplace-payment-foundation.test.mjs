import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const migration=readFileSync(new URL("../supabase/migrations/20261107150000_aivanta_marketplace_financial_ledger.sql",import.meta.url),"utf8");
const spec=readFileSync(new URL("../docs/marketplace/PHASE-2-PAYMENTS.md",import.meta.url),"utf8");
test("financial inbox and ledger are private and append-only",()=>{
 assert.match(migration,/enable row level security/i);
 assert.match(migration,/revoke all on public\.marketplace_payment_events from anon,authenticated/i);
 assert.match(migration,/revoke all on public\.marketplace_financial_ledger from anon,authenticated/i);
 assert.match(migration,/revoke update,delete on public\.marketplace_financial_ledger from service_role/i);
 assert.match(migration,/revoke update,delete on public\.marketplace_payment_events from service_role/i);
});
test("finalization locks purchase and validates provider amount, currency and approved current version",()=>{
 assert.match(migration,/for update/i);
 assert.match(migration,/purchase\.provider<>p_provider/i);
 assert.match(migration,/purchase\.amount_minor<>p_amount_minor/i);
 assert.match(migration,/purchase\.currency<>p_currency/i);
 assert.match(migration,/verification_status='approved'/i);
 assert.match(migration,/current_version_id=purchase\.product_version_id/i);
});
test("finalization grants once and books 20/80 gross split",()=>{
 assert.match(migration,/on conflict\(user_id,product_id,purchase_id\) do nothing/i);
 assert.match(migration,/floor\(p_amount_minor\*0\.20\)/i);
 assert.match(migration,/earning:=p_amount_minor-commission/i);
 assert.match(migration,/gross_sale/);
 assert.match(migration,/platform_commission/);
 assert.match(migration,/creator_earning/);
});
test("provider setup, signatures, replay and external payments remain explicitly gated",()=>{
 for(const phrase of ["signed webhook","idempotency","provider","No entitlement on pending/failed","Do not report payouts as available"])assert.ok(spec.toLowerCase().includes(phrase.toLowerCase()));
});
