import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.API_URL || process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(url && serviceRoleKey);

function resultRow(response) {
  assert.ifError(response.error);
  const row = Array.isArray(response.data) ? response.data[0] : response.data;
  assert.ok(row && typeof row === "object", "claim RPC must return one claim result");
  return row;
}

async function claim(client, args) {
  const response = await client.rpc("claim_billing_webhook_event", {
    p_provider: args.provider,
    p_event_key: args.eventKey,
    p_event_type: args.eventType,
    p_payload_hash: args.payloadHash,
    p_reference: args.reference ?? null,
    p_workspace_id: null,
    p_lease_seconds: 900,
  });
  return resultRow(response);
}

test("parallel Stripe and Paystack deliveries produce one event owner and safe retries", { skip: !enabled }, async () => {
  const client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const scenarios = [
    { provider: "stripe", eventType: "invoice.paid", eventKey: "evt_rexnora_claim_" + randomUUID(), reference: null, table: "billing_recurring_events" },
    { provider: "paystack", eventType: "charge.success", reference: "RexnoraClaim_" + randomUUID(), table: "billing_webhook_events" },
  ];

  for (const scenario of scenarios) {
    const eventKey = scenario.provider === "stripe" ? scenario.eventKey : scenario.eventType + ":" + scenario.reference;
    const payloadHash = createHash("sha256").update(eventKey).digest("hex");
    const args = { ...scenario, eventKey, payloadHash };
    try {
      const firstWave = await Promise.all(Array.from({ length: 16 }, () => claim(client, args)));
      const winners = firstWave.filter((item) => item.claimed === true);
      assert.equal(winners.length, 1, scenario.provider + " concurrent claim winner count");
      const winnerToken = winners[0].claim_token;
      assert.equal(typeof winnerToken, "string");
      assert.ok(firstWave.every((item) => item.claimed === true || item.reason === "in_progress"));

      const wrongCompletion = await client.rpc("complete_billing_webhook_event", {
        p_provider: scenario.provider, p_event_key: eventKey, p_claim_token: randomUUID(),
      });
      assert.ifError(wrongCompletion.error);
      assert.equal(wrongCompletion.data, false, "a non-owner cannot complete the event");

      const wrongRelease = await client.rpc("release_billing_webhook_event", {
        p_provider: scenario.provider, p_event_key: eventKey, p_claim_token: randomUUID(),
        p_error_code: "TEST_RELEASE",
      });
      assert.ifError(wrongRelease.error);
      assert.equal(wrongRelease.data, false, "a non-owner cannot release the event");

      const release = await client.rpc("release_billing_webhook_event", {
        p_provider: scenario.provider, p_event_key: eventKey, p_claim_token: winnerToken,
        p_error_code: "TEST_RETRY",
      });
      assert.ifError(release.error);
      assert.equal(release.data, true, "the owner can release a failed attempt");

      const retryWave = await Promise.all(Array.from({ length: 16 }, () => claim(client, args)));
      const retryWinners = retryWave.filter((item) => item.claimed === true);
      assert.equal(retryWinners.length, 1, scenario.provider + " retry claim winner count");
      const retryToken = retryWinners[0].claim_token;
      assert.notEqual(retryToken, winnerToken, "retry receives a fresh fencing token");

      const staleCompletion = await client.rpc("complete_billing_webhook_event", {
        p_provider: scenario.provider, p_event_key: eventKey, p_claim_token: winnerToken,
      });
      assert.ifError(staleCompletion.error);
      assert.equal(staleCompletion.data, false, "a released stale token cannot complete a later claim");

      const complete = await client.rpc("complete_billing_webhook_event", {
        p_provider: scenario.provider, p_event_key: eventKey, p_claim_token: retryToken,
      });
      assert.ifError(complete.error);
      assert.equal(complete.data, true);

      const duplicate = await claim(client, args);
      assert.equal(duplicate.claimed, false);
      assert.equal(duplicate.reason, "completed", "completed deliveries are acknowledged without reprocessing");
    } finally {
      await client.from(scenario.table).delete().eq("event_key", eventKey);
    }
  }
});
