import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { initializePaystackTransaction, verifyPaystackTransaction, verifyPaystackWebhookSignature } from "../lib/billing/paystack.cjs";

const env = { PAYSTACK_SECRET_KEY: "sk_test_abcdefghijklmnopqrstuvwxyz123456", NODE_ENV: "test" };
const reference = "aivanta-test-ref-1234";

test("verifies Paystack HMAC SHA512 signatures against the exact raw body", () => {
  const raw = JSON.stringify({ event: "charge.success", data: { reference } });
  const signature = createHmac("sha512", env.PAYSTACK_SECRET_KEY).update(raw).digest("hex");
  assert.equal(verifyPaystackWebhookSignature(raw, signature, env), true);
  assert.equal(verifyPaystackWebhookSignature(raw + " ", signature, env), false);
  assert.equal(verifyPaystackWebhookSignature(raw, "bad", env), false);
  assert.equal(verifyPaystackWebhookSignature(raw, signature, {}), false);
});

test("initializes a transaction using server-supplied amount and validates checkout URL", async () => {
  let requestBody;
  const result = await initializePaystackTransaction({
    email: "customer@example.com", amount: 150000, currency: "NGN", reference,
    callbackUrl: "https://aivanta.example.com/api/billing/paystack/callback",
    env,
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://api.paystack.co/transaction/initialize");
      assert.equal(options.headers.Authorization, "Bearer " + env.PAYSTACK_SECRET_KEY);
      requestBody = JSON.parse(options.body);
      return { ok: true, status: 200, json: async () => ({ status: true, data: { authorization_url: "https://checkout.paystack.com/abc123", access_code: "abc123", reference } }) };
    },
  });
  assert.equal(requestBody.amount, 150000);
  assert.equal(requestBody.currency, "NGN");
  assert.equal(result.reference, reference);
  assert.equal(result.authorizationUrl, "https://checkout.paystack.com/abc123");
});

test("rejects invalid amounts, emails, references, currencies and callback URLs before network calls", async () => {
  const neverFetch = async () => { throw new Error("network should not be called"); };
  await assert.rejects(initializePaystackTransaction({ email: "bad", amount: 100, reference, env, fetchImpl: neverFetch }), /PAYSTACK_INVALID_EMAIL/);
  await assert.rejects(initializePaystackTransaction({ email: "a@b.com", amount: 0, reference, env, fetchImpl: neverFetch }), /PAYSTACK_INVALID_AMOUNT/);
  await assert.rejects(initializePaystackTransaction({ email: "a@b.com", amount: 100, reference: "bad ref", env, fetchImpl: neverFetch }), /PAYSTACK_INVALID_REFERENCE/);
  await assert.rejects(initializePaystackTransaction({ email: "a@b.com", amount: 100, currency: "XYZ", reference, env, fetchImpl: neverFetch }), /PAYSTACK_INVALID_CURRENCY/);
  await assert.rejects(initializePaystackTransaction({ email: "a@b.com", amount: 100, reference, callbackUrl: "http://evil.example", env: { ...env, NODE_ENV: "production" }, fetchImpl: neverFetch }), /PAYSTACK_INVALID_CALLBACK/);
});

test("verifies transaction reference and returns only normalized payment facts", async () => {
  const result = await verifyPaystackTransaction({
    reference, env,
    fetchImpl: async url => {
      assert.equal(url, "https://api.paystack.co/transaction/verify/" + reference);
      return { ok: true, status: 200, json: async () => ({ status: true, data: { reference, status: "success", amount: 150000, currency: "NGN", customer: { email: "customer@example.com" }, paid_at: "2026-11-04T00:00:00Z", authorization: { secret: "must-not-leak" } } }) };
    },
  });
  assert.deepEqual(result, { reference, status: "success", amount: 150000, currency: "NGN", customerEmail: "customer@example.com", paidAt: "2026-11-04T00:00:00Z" });
});

test("rejects missing credentials and provider errors without exposing secrets", async () => {
  await assert.rejects(initializePaystackTransaction({ email: "a@b.com", amount: 100, reference, env: {}, fetchImpl: async () => { throw new Error("must not run"); } }), /PAYSTACK_NOT_CONFIGURED/);
  await assert.rejects(verifyPaystackTransaction({ reference, env, fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ status: false }) }) }), /PAYSTACK_AUTH_ERROR/);
});
