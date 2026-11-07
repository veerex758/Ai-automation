import { createHash } from "node:crypto";
import {
  assertFreshVerifiedWebhook,
  assertMarketplacePayment,
  type MarketplacePaymentProvider,
  type VerifiedMarketplaceWebhook,
  type ParsedMarketplaceReversal as ProviderParsedMarketplaceReversal,
  type ParsedMarketplaceSubscription,
  assertMarketplaceSubscription,
} from "./provider";

export type MarketplaceWebhookProcessor = {
  finalizePayment(input: {
    provider: string; eventId: string; purchaseId: string; providerPaymentId: string;
    amountMinor: number; currency: string; payloadSha256: string; occurredAt: string;
  }): Promise<unknown>;
  reversePayment(input: {
    provider: string; eventId: string; purchaseId: string; kind: "refund" | "chargeback";
    amountMinor: number; payloadSha256: string; occurredAt: string;
  }): Promise<unknown>;
  applySubscriptionEvent(input: {
    provider: string; eventId: string; payloadSha256: string; eventType: ParsedMarketplaceSubscription["eventType"];
    buyerUserId: string; productId: string; productVersionId: string; providerSubscriptionId: string;
    periodStart: string; periodEnd: string; occurredAt: string;
  }): Promise<unknown>;
};

export type ParsedMarketplaceReversal = ProviderParsedMarketplaceReversal;

export async function processMarketplaceWebhook(
  provider: MarketplacePaymentProvider,
  processor: MarketplaceWebhookProcessor,
  rawBody: Uint8Array,
  headers: Headers,
  nowMs = Date.now(),
): Promise<{ eventId: string; outcome: unknown }> {
  if (!(rawBody instanceof Uint8Array) || rawBody.byteLength === 0 || rawBody.byteLength > 1_000_000) {
    throw new Error("invalid_webhook_body_size");
  }
  // Adapter verifies signature against exact raw bytes before this event is trusted.
  const event: VerifiedMarketplaceWebhook = await provider.verifyWebhook(rawBody, headers);
  assertFreshVerifiedWebhook(event, nowMs);
  const digest = createHash("sha256").update(rawBody).digest("hex");
  if (event.type === "payment.succeeded") {
    const payment = provider.parsePayment(event);
    assertMarketplacePayment(payment);
    const outcome = await processor.finalizePayment({
      provider: provider.id, eventId: event.eventId, purchaseId: payment.purchaseId,
      providerPaymentId: payment.providerPaymentId, amountMinor: payment.amountMinor,
      currency: payment.currency, payloadSha256: digest, occurredAt: event.occurredAt,
    });
    return { eventId: event.eventId, outcome };
  }
  if (event.type.startsWith("subscription.") || event.type.startsWith("invoice.")) {
    const parseSubscription = (provider as MarketplacePaymentProvider & {
      parseSubscription?: (event: VerifiedMarketplaceWebhook) => ParsedMarketplaceSubscription | null;
    }).parseSubscription;
    const subscription = parseSubscription?.(event);
    if (!subscription) return { eventId: event.eventId, outcome: { status: "ignored", eventType: event.type } };
    assertMarketplaceSubscription(subscription);
    const outcome = await processor.applySubscriptionEvent({
      provider: provider.id, eventId: event.eventId, payloadSha256: digest,
      eventType: subscription.eventType, buyerUserId: subscription.buyerUserId,
      productId: subscription.productId, productVersionId: subscription.productVersionId,
      providerSubscriptionId: subscription.providerSubscriptionId,
      periodStart: subscription.periodStart, periodEnd: subscription.periodEnd,
      occurredAt: event.occurredAt,
    });
    return { eventId: event.eventId, outcome };
  }
  if (event.type === "refund.succeeded" || event.type === "chargeback.created") {
    const parseReversal = (provider as MarketplacePaymentProvider & {
      parseReversal?: (event: VerifiedMarketplaceWebhook) => ParsedMarketplaceReversal | null;
    }).parseReversal;
    const reversal = parseReversal?.(event);
    if (!reversal || !reversal.purchaseId || !Number.isSafeInteger(reversal.amountMinor) || reversal.amountMinor <= 0) {
      throw new Error("invalid_reversal_payload");
    }
    const kind = event.type === "refund.succeeded" ? "refund" : "chargeback";
    if (reversal.kind !== kind) throw new Error("reversal_event_type_mismatch");
    const outcome = await processor.reversePayment({
      provider: provider.id, eventId: event.eventId, purchaseId: reversal.purchaseId,
      kind, amountMinor: reversal.amountMinor, payloadSha256: digest, occurredAt: event.occurredAt,
    });
    return { eventId: event.eventId, outcome };
  }
  return { eventId: event.eventId, outcome: { status: "ignored", eventType: event.type } };
}
