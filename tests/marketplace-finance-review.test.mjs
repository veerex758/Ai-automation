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
 assert.doesNotMatch(page,/input[^>]*transfer/i);
 assert.doesNotMatch(page,/action\s*:\s*[\x27\x22]paid/);
});

test("settlement RPC is service-only, idempotent, and appends a single ledger debit",()=>{
 assert.match(settlement,/auth\.role\(\)<>'service_role'/);
 assert.match(settlement,/provider_transfer_id/);
 assert.match(settlement,/duplicate_settlement/);
 assert.match(settlement,/on conflict(payout_request_id)/);
 assert.match(settlement,/'payout',-payout\.amount_minor/);
 assert.match(settlement,/insert into public\.marketplace_financial_ledger/);
});

test("finance payout review transitions remain explicit and audited",()=>{
 assert.match(monetization,/when 'review' then 'under_review'/);
 assert.match(monetization,/payout_transition_invalid/);
 assert.match(monetization,/insert into public.marketplace_admin_audit/);
});

const supportRoute=readFileSync(new URL("../app/api/marketplace/admin/support/route.ts",import.meta.url),"utf8");
const supportReview=readFileSync(new URL("../supabase/migrations/20261107175000_aivanta_marketplace_phase3_support_review.sql",import.meta.url),"utf8");
const supportPage=readFileSync(new URL("../app/marketplace/admin/support/page.tsx",import.meta.url),"utf8");
test("creator support review is reviewer-gated and status plus audit are atomic",()=>{
 assert.match(supportRoute,/AIVANTA_MARKETPLACE_REVIEWER_IDS/);
 assert.match(supportRoute,/marketplace_review_creator_support_case/);
 assert.doesNotMatch(supportRoute,/from\("marketplace_creator_support_cases"\)\.update/);
 assert.match(supportReview,/for update/);
 assert.match(supportReview,/insert into public\.marketplace_admin_audit/);
 assert.match(supportReview,/support_case_transition_invalid/);
 assert.match(supportPage,/Audit note/);
});

test("creator payout transfer route is finance-gated, eligibility checked and reconciled",()=>{const transfer=readFileSync(new URL("../app/api/marketplace/admin/payouts/transfer/route.ts",import.meta.url),"utf8");assert.match(transfer,/AIVANTA_MARKETPLACE_PAYOUTS_ENABLED/);assert.match(transfer,/AIVANTA_MARKETPLACE_REVIEWER_IDS/);assert.match(transfer,/onboarding_status!=="verified"/);assert.match(transfer,/tax_status!=="complete"/);assert.match(transfer,/status!=="approved"/);assert.match(transfer,/marketplace_admin_audit/);assert.match(transfer,/status:"processing"/)});
