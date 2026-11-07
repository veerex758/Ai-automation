# Marketplace Phase 2 — Payment provider + ledger (implementation contract)

Status: database foundation + provider-neutral adapter contract implemented on PR #162. Checkout remains disabled until a provider, country eligibility, credentials, and webhook secret are configured and explicitly authorized.

## Required invariants
- Provider adapter is server-only; client never chooses amount, currency, creator, commission, entitlement, or verified version.
- Checkout resolves product slug -> published product -> approved current immutable version, reads exact USD amount from DB, rejects free products and unavailable/suspended products.
- Provider create-checkout receives server amount, currency, product/version/purchase ID metadata, and idempotency key. Persist pending purchase before redirect.
- Only verified provider webhook event can transition pending purchase to paid. Webhook signature is validated against raw request bytes; timestamp tolerance and event ID dedupe are mandatory.
- Purchase status, entitlement, and balanced ledger entries commit atomically. Duplicate event IDs / provider payment IDs cannot duplicate any financial side effect.
- Refunds/disputes append reversing entries and update entitlement; never delete ledger history.
- Creator split: 20% platform commission, 80% creator gross share before separately itemized processor/tax/refund/dispute adjustments.
- Do not report payouts as available until provider payout rail, creator KYC, country eligibility, holds, and reconciliation are implemented.
- No external money movement or live checkout in test/CI.

## Provider-neutral adapter
```ts
export type MarketplacePaymentProvider = {
 id: string;
 createCheckout(input: {purchaseId:string; idempotencyKey:string; amountMinor:number; currency:"USD"; product:{id:string;slug:string;name:string}; versionId:string; buyerId:string; successUrl:string; cancelUrl:string }): Promise<{checkoutUrl:string; providerCheckoutId:string}>;
 verifyWebhook(rawBody:Uint8Array,headers:Headers): Promise<{eventId:string;type:string;occurredAt:string;data:unknown}>;
 parsePayment(event:unknown): {purchaseId:string;providerPaymentId:string;amountMinor:number;currency:string}|null;
};
```

## Durable database foundation (review before staging)
- Event inbox keyed by provider/event ID and processing state.
- Append-only ledger with unique provider event + entry type + purchase guard.
- Server-only RPC locks purchase; verifies exact expected amount/currency/provider; marks paid once; creates entitlement once; records gross, platform commission, creator earning.
- Refund/chargeback RPC locks purchase, deduplicates provider event, validates the event hash, caps cumulative refund + chargeback reversals against the original paid amount, appends reversal rows for gross/commission/creator share, updates purchase state, and revokes entitlement on full refund/dispute. No direct ledger UPDATE/DELETE. SQL runtime/concurrency verification remains required.
- Provider-neutral TypeScript contract requires raw-body signature verification in each adapter, a verified event envelope, a five-minute freshness guard, and normalized USD/integer-minor-unit payment validation. No provider adapter is enabled.
- RLS denies anon and ordinary users ledger/inbox writes; service-role processing only. Buyer can read own purchase/receipt; creator can read own earnings aggregate only through scoped RPC.
- Reconciliation report compares provider events/settlement against purchases and ledger, flags mismatch; never auto-adjusts without authorized finance action.

## Gates
1. Unit tests provider adapter signature, invalid signature, stale timestamp, replay/idempotency, mismatched amount/currency, duplicate payment ID.
2. DB tests duplicate event, duplicate payment, concurrent processing, pending/failed no entitlement, refund reversal, creator/platform split balance.
3. CI clean migration replay, lint, typecheck, tests; no hosted DB apply without approval.
4. Staging signed test-mode webhook and authenticated buyer checkout; browser E2E after Vercel quota.
5. Production requires provider/country/legal/compliance confirmation, secrets configured, finance/reconciliation controls and explicit launch authorization.

## Deliberately blocked
- Live checkout, subscriptions, refunds, transfers/payouts, tax invoices, creator payout availability, automatic finance adjustments.
- Provider-specific implementation until provider choice and test credentials are supplied.

- Provider-neutral webhook orchestration now verifies the provider adapter against raw bytes, rejects empty/oversize bodies, applies event freshness checks, hashes raw payload bytes, dispatches payment success to atomic finalization, refunds/chargebacks to reversal, and safely ignores other verified event types. The actual provider signature adapter and HTTP route remain unconfigured until provider selection.
