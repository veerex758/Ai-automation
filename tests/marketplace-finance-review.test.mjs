import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const route=readFileSync(new URL("../app/api/marketplace/admin/payouts/route.ts",import.meta.url),"utf8");
const page=readFileSync(new URL("../app/marketplace/admin/finance/page.tsx",import.meta.url),"utf8");
const settlement=readFileSync(new URL("../supabase/migrations/20261107173000_aivanta_marketplace_phase3_payout_settlement.sql",import.meta.url),"utf8");
const monetization=readFileSync(new URL("../supabase/migrations/20261107160000_aivanta_marketplace_phase3_creator_monetization.sql",import.meta.url),"utf8");

test("finance queue and mutations require explicit reviewer allowlist and service role",()=>{
 assert.match(route,/AIVANTA_MARKETPLACE_REVIEWER_IDS/);
 assert.match(route,/marketplace_review_payout_request/);
 assert.match(route,/SUPABASE_SERVICE_ROLE_KEY/);
 assert.match(route,/private, no-store/);
});

test("reviewer UI cannot mark payout paid or enter transfer references",()=>{
 assert.match(page,/paid status is only set by verified provider settlement reconciliation/);
 assert.doesNotMatch(page,/action:"paid"/);
 assert.doesNotMatch(page,/transfer_id/);
});

test("settlement RPC is service-only, idempotent, and appends a single ledger debit",()=>{
 assert.match(settlement,/auth.role()<>'service_role'/);
 assert.match(settlement,/provider_transfer_id/);
 assert.match(settlement,/duplicate_settlement/);
 assert.match(settlement,/on conflict(payout_request_id)/);
 assert.match(settlement,/entry_type,amount_minor/);
});

test("finance payout review transitions remain explicit and audited",()=>{
 assert.match(monetization,/when 'review' then 'under_review'/);
 assert.match(monetization,/payout_transition_invalid/);
 assert.match(monetization,/insert into public.marketplace_admin_audit/);
});
