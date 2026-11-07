import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20261107150000_aivanta_marketplace_financial_ledger.sql", import.meta.url), "utf8");
const spec = readFileSync(new URL("../docs/marketplace/PHASE-2-PAYMENTS.md", import.meta.url), "utf8");

test("financial inbox and ledger are private and append-only", () => {
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all on public\.marketplace_payment_events from anon,authenticated/i);
  assert.match(migration, /revoke all on public\.marketplace_financial_ledger from anon,authenticated/i);
  assert.match(migration, /revoke update,delete on public\.marketplace_financial_ledger from service_role/i);
  assert.match(migration, /revoke update,delete on public\.marketplace_payment_events from service_role/i);
});

test("finalization locks purchase and validates provider, amount, currency and approved current version", () => {
  assert.match(migration, /for update/i);
  assert.match(migration, /purchase\.provider<>p_provider/i);
  assert.match(migration, /purchase\.amount_minor<>p_amount_minor/i);
  assert.match(migration, /purchase\.currency<>p_currency/i);
  assert.match(migration, /verification_status='approved'/i);
  assert.match(migration, /current_version_id=purchase\.product_version_id/i);
});

test("finalization grants once and books the 20/80 gross split", () => {
  assert.match(migration, /on conflict\(user_id,product_id,purchase_id\) do nothing/i);
  assert.match(migration, /floor\(p_amount_minor\*0\.20\)/i);
  assert.match(migration, /earning:=p_amount_minor-commission/i);
  assert.match(migration, /gross_sale/);
  assert.match(migration, /platform_commission/);
  assert.match(migration, /creator_earning/);
});

test("provider setup, signature, replay and money movement remain explicitly gated", () => {
  for (const phrase of ["signed webhook", "idempotency", "provider", "No entitlement on pending/failed", "Do not report payouts as available"]) {
    assert.ok(spec.toLowerCase().includes(phrase.toLowerCase()));
  }
});

test("finalizer records supplied event digest and timestamp", () => {
  assert.match(migration, /p_payload_sha256 is null or p_payload_sha256 !~ '\\^\[a-f0-9\]\\{64\\}\\$'/i);
  assert.match(migration, /p_payload_sha256,coalesce\(p_occurred_at,now\(\)\)/i);
  assert.doesNotMatch(migration, /repeat\('0',64\)/);
});

test("refund and chargeback append reversal entries, cap cumulative reversals and revoke entitlement", () => {
  assert.match(migration, /create or replace function public\.marketplace_reverse_payment/i);
  assert.match(migration, /p_kind not in \('refund','chargeback'\)/i);
  assert.match(migration, /prior_refund\+p_amount_minor>purchase\.amount_minor-prior_chargeback/i);
  assert.match(migration, /prior_chargeback\+p_amount_minor>purchase\.amount_minor-prior_refund/i);
  assert.match(migration, /prior_refund\+prior_chargeback\+p_amount_minor>=purchase\.amount_minor/i);
  assert.match(migration, /commission reversal/i);
  assert.match(migration, /Creator earning reversal/i);
  assert.match(migration, /status='revoked' where purchase_id=purchase\.id/i);
  assert.match(migration, /duplicate_event/i);
  assert.match(migration, /revoke all on function public\.marketplace_reverse_payment/i);
});

test("migration ends cleanly with exactly one finalizer and reversal function", () => {
  assert.ok(migration.trimEnd().endsWith("revoke update,delete on public.marketplace_payment_events from service_role;"));
  assert.equal((migration.match(/create or replace function public\.marketplace_finalize_payment/g) || []).length, 1);
  assert.equal((migration.match(/create or replace function public\.marketplace_reverse_payment/g) || []).length, 1);
  assert.doesNotMatch(migration, /repeat\('0',64\)/);
});
