import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20261124110000_rexnora_atomic_billing_webhook_claims.sql", import.meta.url), "utf8");
const stripe = readFileSync(new URL("../app/api/billing/stripe/subscription-webhook/route.ts", import.meta.url), "utf8");
const paystack = readFileSync(new URL("../app/api/billing/webhook/route.ts", import.meta.url), "utf8");

test("both providers use the atomic database claim instead of read-then-process ledgers", () => {
  for (const source of [stripe, paystack]) {
    assert.match(source, /rpc\("claim_billing_webhook_event"/);
    assert.match(source, /rpc\("complete_billing_webhook_event"/);
    assert.match(source, /rpc\("release_billing_webhook_event"/);
    assert.match(source, /claimRecord\.reason==="in_progress"\|\|claimRecord\.reason==="completed"/);
    assert.match(source, /WEBHOOK_CLAIM_UNAVAILABLE/);
    assert.match(source, /createHash\("sha256"\)/);
    assert.doesNotMatch(source, /select\("processed_at"\)/);
  }
  assert.doesNotMatch(stripe, /from\("billing_recurring_events"\)/);
  assert.doesNotMatch(paystack, /from\("billing_webhook_events"\)/);
});

test("the claim is a guarded single-row update with an expiring token lease", () => {
  assert.match(migration, /update public\.billing_recurring_events e[\s\S]*?e\.processed_at is null[\s\S]*?e\.claim_expires_at <= v_now/i);
  assert.match(migration, /update public\.billing_webhook_events e[\s\S]*?e\.processed_at is null[\s\S]*?e\.claim_expires_at <= v_now/i);
  assert.match(migration, /claim_token = pg_catalog.gen_random_uuid\(\)/i);
  assert.match(migration, /returning e\.claim_token into v_token/i);
  assert.match(migration, /e\.payload_hash = p_payload_hash/i);
  assert.match(migration, /e\.payload_hash is null or e\.payload_hash = p_payload_hash/i);
});

test("only the current claim token can complete or release a webhook event", () => {
  for (const providerBlock of migration.split("create or replace function public.release_billing_webhook_event")) {
    assert.match(providerBlock, /claim_token = p_claim_token/i);
  }
  assert.match(migration, /set processed_at = pg_catalog\.now\(\), claim_token = null, claim_expires_at = null/i);
  assert.match(migration, /set claim_token = null, claim_expires_at = null, processing_error = v_error_code/i);
  assert.match(migration, /revoke all on function public\.claim_billing_webhook_event[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.claim_billing_webhook_event[\s\S]*to service_role/i);
});
