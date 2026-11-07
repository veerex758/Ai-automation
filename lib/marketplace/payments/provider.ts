/**
 * Server-only, provider-neutral marketplace payment contract.
 * Provider adapters must verify signatures against raw request bytes before
 * returning an event from verifyWebhook. No adapter is enabled by this module.
 */
export type MarketplaceCheckoutInput = {
  purchaseId: string;
  idempotencyKey: string;
  amountMinor: number;
  currency: "USD";
  product: { id: string; slug: string; name: string };
  versionId: string;
  buyerId: string;
  successUrl: string;
  cancelUrl: string;
};

export type VerifiedMarketplaceWebhook = {
  eventId: string;
  type: string;
  occurredAt: string;
  data: unknown;
};

export type ParsedMarketplaceReversal = {\n  purchaseId: string;\n  kind: "refund" | "chargeback";\n  amountMinor: number;\n};\n\nexport type ParsedMarketplacePayment = {
  purchaseId: string;
  providerPaymentId: string;
  amountMinor: number;
  currency: string;
};

export interface MarketplacePaymentProvider {
  readonly id: string;
  createCheckout(input: MarketplaceCheckoutInput): Promise<{
    checkoutUrl: string;
    providerCheckoutId: string;
  }>;
  /** Must validate provider signature over rawBody; never trust parsed JSON alone. */
  verifyWebhook(rawBody: Uint8Array, headers: Headers): Promise<VerifiedMarketplaceWebhook>;
  parsePayment(event: VerifiedMarketplaceWebhook): ParsedMarketplacePayment | null;\n  /** Optional provider-normalized refund/chargeback payload after signature verification. */\n  parseReversal?(event: VerifiedMarketplaceWebhook): ParsedMarketplaceReversal | null;
}

/** Common envelope guard after provider-specific signature verification. */
export function assertFreshVerifiedWebhook(
  event: VerifiedMarketplaceWebhook,
  nowMs = Date.now(),
  toleranceMs = 5 * 60 * 1000,
): void {
  if (!event || typeof event.eventId !== "string" || event.eventId.length < 1 || event.eventId.length > 255) {
    throw new Error("invalid_webhook_event_id");
  }
  if (typeof event.type !== "string" || event.type.length < 1 || event.type.length > 160) {
    throw new Error("invalid_webhook_event_type");
  }
  const occurredAtMs = Date.parse(event.occurredAt);
  if (!Number.isFinite(occurredAtMs) || Math.abs(nowMs - occurredAtMs) > toleranceMs) {
    throw new Error("stale_webhook_event");
  }
}

/** Validate normalized payment data before passing it to the atomic DB RPC. */
export function assertMarketplacePayment(
  payment: ParsedMarketplacePayment | null,
): asserts payment is ParsedMarketplacePayment {
  if (!payment || !payment.purchaseId || !payment.providerPaymentId) {
    throw new Error("invalid_payment_payload");
  }
  if (!Number.isSafeInteger(payment.amountMinor) || payment.amountMinor <= 0 || payment.currency !== "USD") {
    throw new Error("invalid_payment_amount");
  }
}
