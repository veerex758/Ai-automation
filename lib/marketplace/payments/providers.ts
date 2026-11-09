import { createHmac, timingSafeEqual } from "node:crypto";
import type { MarketplaceCheckoutInput, MarketplacePaymentProvider, VerifiedMarketplaceWebhook, ParsedMarketplacePayment } from "./provider";

function secret(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`payment_provider_not_configured:${name}`);
  return value;
}
function constantTimeHex(expected: string, actual: string): boolean {
  if (!/^[a-f0-9]+$/i.test(actual) || expected.length !== actual.length) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(actual, "hex"));
}
function jsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_provider_payload");
  return value as Record<string, unknown>;
}
function usdAmount(amount: number): void {
  if (!Number.isSafeInteger(amount) || amount < 50) throw new Error("invalid_usd_amount_minor");
}
function metadata(input: MarketplaceCheckoutInput) {
  return { purchase_id: input.purchaseId, product_id: input.product.id, product_version_id: input.versionId, buyer_id: input.buyerId };
}

export class PaystackMarketplaceProvider implements MarketplacePaymentProvider {
  readonly id = "paystack";
  async createCheckout(input: MarketplaceCheckoutInput) {
    usdAmount(input.amountMinor);
    if (input.currency !== "USD") throw new Error("unsupported_currency");
    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST", headers: { authorization: `Bearer ${secret("PAYSTACK_SECRET_KEY")}`, "content-type": "application/json" },
      body: JSON.stringify({ email: input.buyerEmail, amount: input.amountMinor, currency: "USD", reference: input.idempotencyKey,
        callback_url: input.successUrl, metadata: metadata(input), channels: ["card"] }),
      signal: AbortSignal.timeout(12_000),
    });
    const body = jsonObject(await response.json());
    const data = jsonObject(body.data);
    if (!response.ok || body.status !== true || typeof data.authorization_url !== "string" || typeof data.reference !== "string") {
      throw new Error("paystack_checkout_failed");
    }
    return { checkoutUrl: data.authorization_url, providerCheckoutId: data.reference };
  }
  async verifyWebhook(rawBody: Uint8Array, headers: Headers): Promise<VerifiedMarketplaceWebhook> {
    const signature = headers.get("x-paystack-signature") ?? "";
    const expected = createHmac("sha512", secret("PAYSTACK_WEBHOOK_SECRET")).update(rawBody).digest("hex");
    if (!constantTimeHex(expected, signature)) throw new Error("invalid_paystack_signature");
    const root = jsonObject(JSON.parse(Buffer.from(rawBody).toString("utf8")));
    const data = jsonObject(root.data);
    const created = Number(data.createdAt ?? data.created_at ?? root.createdAt ?? root.created_at);
    const occurredAt = Number.isFinite(created) ? new Date(created < 1e12 ? created * 1000 : created).toISOString() : "";
    return { eventId: String(data.id ?? data.reference ?? ""), type: ({ "charge.success": "payment.succeeded", "refund.processed": "refund.succeeded" } as Record<string,string>)[String(root.event ?? "")] ?? String(root.event ?? ""),
      occurredAt, data: root };
  }
  parsePayment(event: VerifiedMarketplaceWebhook): ParsedMarketplacePayment | null {
    if (event.type !== "payment.succeeded") return null;
    const root = jsonObject(event.data); const data = jsonObject(root.data); const meta = jsonObject(data.metadata);
    if (data.status !== "success") return null;
    return { purchaseId: String(meta.purchase_id ?? ""), providerPaymentId: String(data.reference ?? ""),
      amountMinor: Number(data.amount), currency: String(data.currency ?? "") };
  }
  parseReversal(event: VerifiedMarketplaceWebhook) {
    const root = jsonObject(event.data); const data = jsonObject(root.data); const meta = jsonObject(data.metadata);
    if (event.type === "refund.succeeded") return { purchaseId: String(meta.purchase_id ?? ""), kind: "refund" as const, amountMinor: Number(data.amount) };
    return null;
  }
}

export class StripeMarketplaceProvider implements MarketplacePaymentProvider {
  readonly id = "stripe";
  async createCheckout(input: MarketplaceCheckoutInput) {
    usdAmount(input.amountMinor);
    if (input.currency !== "USD") throw new Error("unsupported_currency");
    const form = new URLSearchParams({ mode: "payment", success_url: input.successUrl, cancel_url: input.cancelUrl,
      "client_reference_id": input.purchaseId, "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": String(input.amountMinor),
      "line_items[0][price_data][product_data][name]": input.product.name, "line_items[0][quantity]": "1",
      "metadata[purchase_id]": input.purchaseId, "metadata[product_id]": input.product.id,
      "metadata[product_version_id]": input.versionId, "metadata[buyer_id]": input.buyerId });
    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST", headers: { authorization: `Bearer ${secret("STRIPE_SECRET_KEY")}`, "content-type": "application/x-www-form-urlencoded",
        "idempotency-key": input.idempotencyKey }, body: form, signal: AbortSignal.timeout(12_000) });
    const data = jsonObject(await response.json());
    if (!response.ok || typeof data.url !== "string" || typeof data.id !== "string") throw new Error("stripe_checkout_failed");
    return { checkoutUrl: data.url, providerCheckoutId: data.id };
  }
  async verifyWebhook(rawBody: Uint8Array, headers: Headers): Promise<VerifiedMarketplaceWebhook> {
    const signature = headers.get("stripe-signature") ?? "";
    const parts = signature.split(",").map(x => x.trim().split("="));
    const timestamp = parts.find(([k]) => k === "t")?.[1];
    const signatures = parts.filter(([k]) => k === "v1").map(([,v]) => v);
    if (!timestamp || !/^\d+$/.test(timestamp) || !signatures.length) throw new Error("invalid_stripe_signature");
    const ts = Number(timestamp);
    if (Math.abs(Date.now() - ts * 1000) > 5 * 60 * 1000) throw new Error("stale_stripe_signature");
    const signed = Buffer.concat([Buffer.from(timestamp + "."), Buffer.from(rawBody)]);
    const expected = createHmac("sha256", secret("STRIPE_WEBHOOK_SECRET")).update(signed).digest("hex");
    if (!signatures.some(v => constantTimeHex(expected, v))) throw new Error("invalid_stripe_signature");
    const root = jsonObject(JSON.parse(Buffer.from(rawBody).toString("utf8")));
    return { eventId: String(root.id ?? ""), type: ({ "checkout.session.completed": "payment.succeeded", "charge.refunded": "refund.succeeded", "charge.dispute.created": "chargeback.created" } as Record<string,string>)[String(root.type ?? "")] ?? String(root.type ?? ""), occurredAt: new Date(ts * 1000).toISOString(), data: root };
  }
  parsePayment(event: VerifiedMarketplaceWebhook): ParsedMarketplacePayment | null {
    if (event.type !== "payment.succeeded") return null;
    const root = jsonObject(event.data); const data = jsonObject(root.data); const session = jsonObject(data.object); const meta = jsonObject(session.metadata);
    if (session.payment_status !== "paid") return null;
    return { purchaseId: String(meta.purchase_id ?? session.client_reference_id ?? ""), providerPaymentId: String(session.payment_intent ?? session.id ?? ""),
      amountMinor: Number(session.amount_total), currency: String(session.currency ?? "").toUpperCase() };
  }
  parseReversal(event: VerifiedMarketplaceWebhook) {
    const root = jsonObject(event.data); const data = jsonObject(root.data); const object = jsonObject(data.object); const meta = jsonObject(object.metadata);
    if (event.type === "refund.succeeded") return { purchaseId: String(meta.purchase_id ?? ""), kind: "refund" as const, amountMinor: Number(object.amount_refunded) };
    if (event.type === "chargeback.created") return { purchaseId: String(meta.purchase_id ?? ""), kind: "chargeback" as const, amountMinor: Number(object.amount) };
    return null;
  }
}
