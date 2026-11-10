import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { PaystackMarketplaceProvider, StripeMarketplaceProvider } from "../lib/marketplace/payments/providers";

test("Paystack verifies exact raw bytes and normalizes successful USD charge", async () => {
  process.env.PAYSTACK_WEBHOOK_SECRET = "test-secret";
  const raw = Buffer.from(JSON.stringify({ event: "charge.success", data: { id: 42, reference: "purchase-ref", status: "success", amount: 1200, currency: "USD", createdAt: Math.floor(Date.now()/1000), metadata: { purchase_id: "purchase-1" } } }));
  const sig = createHmac("sha512", process.env.PAYSTACK_WEBHOOK_SECRET).update(raw).digest("hex");
  const provider = new PaystackMarketplaceProvider();
  const event = await provider.verifyWebhook(raw, new Headers({ "x-paystack-signature": sig }));
  assert.equal(event.type, "payment.succeeded");
  assert.equal(provider.parsePayment(event)?.purchaseId, "purchase-1");
  assert.equal(provider.parsePayment(event)?.amountMinor, 1200);
  await assert.rejects(provider.verifyWebhook(Buffer.from(raw.toString()+" "), new Headers({ "x-paystack-signature": sig })), /invalid_paystack_signature/);
});

test("Stripe verifies timestamped signature and normalizes paid Checkout USD session", async () => {
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  const timestamp = Math.floor(Date.now()/1000);
  const raw = Buffer.from(JSON.stringify({ id: "evt_123", type: "checkout.session.completed", data: { object: { id: "cs_123", payment_intent: "pi_123", payment_status: "paid", amount_total: 2500, currency: "usd", client_reference_id: "purchase-2", metadata: { purchase_id: "purchase-2" } } } }));
  const sig = createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET).update(Buffer.concat([Buffer.from(timestamp+"."),raw])).digest("hex");
  const provider = new StripeMarketplaceProvider();
  const event = await provider.verifyWebhook(raw, new Headers({ "stripe-signature": `t=${timestamp},v1=${sig}` }));
  assert.equal(provider.parsePayment(event)?.providerPaymentId, "pi_123");
  assert.equal(provider.parsePayment(event)?.currency, "USD");
  await assert.rejects(provider.verifyWebhook(raw, new Headers({ "stripe-signature": `t=${timestamp},v1=00` })), /invalid_stripe_signature/);
});
