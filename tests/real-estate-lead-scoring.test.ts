import test from "node:test";
import assert from "node:assert/strict";
import { buildFollowupSchedule, matchRealEstateProperties, scoreRealEstateLead } from "../lib/real-estate/lead-scoring";

test("lead score is deterministic, bounded and explainable", () => {
  const lead = { transactionType: "buy" as const, propertyType: "apartment" as const, preferredLocation: "Dubai Marina", budgetMin: 100000, budgetMax: 150000, timeframe: "within_30_days" as const, readiness: "pre_approved" as const, email: "buyer@example.test", phone: "+971500000000" };
  const result = scoreRealEstateLead(lead);
  assert.equal(result.score, 98);
  assert.equal(result.temperature, "hot");
  assert.equal(result.factors.reduce((sum, factor) => sum + factor.points, 0), result.score);
  assert.ok(result.factors.every((factor) => factor.points <= factor.maximum));
});

test("missing information never produces a high score", () => {
  const result = scoreRealEstateLead({});
  assert.equal(result.score, 0);
  assert.equal(result.temperature, "cold");
  assert.ok(result.factors.some((factor) => factor.key === "contact" && factor.points === 0));
});

test("property matching excludes stale, unavailable and unpriced listings", () => {
  const now = Date.now();
  const good = { id: "p1", title: "Dubai Marina 2BR", property_type: "apartment", transaction_type: "sale", location: "Dubai Marina", price: 145000, currency: "USD", bedrooms: 2, availability_status: "available", available: true, last_verified_at: new Date(now - 3600000).toISOString() };
  const matches = matchRealEstateProperties({ transactionType: "buy", propertyType: "apartment", preferredLocation: "Dubai Marina", budgetMax: 150000, currency: "USD", bedrooms: 2 }, [
    good,
    { ...good, id: "p2", available: false },
    { ...good, id: "p3", last_verified_at: new Date(now - 9 * 86400000).toISOString() },
    { ...good, id: "p4", price: 0 },
  ], now);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].property.id, "p1");
  assert.ok(matches[0].score >= 80);
});

test("follow-up schedule has the exact requested five checkpoints", () => {
  const start = new Date("2026-11-20T12:00:00.000Z");
  const plan = buildFollowupSchedule(start);
  assert.deepEqual(plan.map(x => x.delayLabel), ["Immediately", "1 hour", "24 hours", "3 days", "7 days"]);
  assert.equal(plan[4].dueAt, "2026-11-27T12:00:00.000Z");
});
