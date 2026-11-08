# Marketplace Phase 2 — Payment provider + ledger (implementation contract)

Status: Phase 2 provider-neutral payment foundation implemented on PR #162; clean migration replay, pgTAP transaction tests, workflow validation, lint, type-check, and build are green at commit `c7dc1f8`. Checkout remains disabled until provider/country eligibility, credentials, provider signature adapter, and webhook secret are configured and explicitly authorized.

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
- Service-only gross reconciliation report compares paid purchase amounts with gross-sale ledger entries and returns discrepancies; it never auto-adjusts. Provider settlement-file reconciliation remains pending provider selection and credentials.

## Gates / verification status
1. Provider-neutral unit/static coverage for freshness, replay/idempotency, mismatched amount/currency, duplicate payment IDs and webhook dispatch: implemented.
2. pgTAP transaction coverage for payment finalization, duplicate event/payment, pending/failed no entitlement, reversal and ledger split: implemented and passing in clean local migration replay. Provider-specific signature and true concurrent race testing still require adapter/provider setup.
3. Clean migration replay + pgTAP, workflow validation, lint, type-check, and build: green on `c7dc1f8` (CI run 2114; migration replay run 756). No hosted DB apply.
4. Staging signed provider test webhook/authenticated buyer checkout and browser E2E: blocked pending provider selection/credentials and Vercel quota.
5. Production: not authorized; provider/country/legal/compliance, secrets, settlement reconciliation and explicit launch approval required.

## Current progress (2026-11-07)\n- Provider contract now includes optional normalized refund/chargeback parsing; processor dispatch is typed and covered by a refund test.\n- Finalizer records duplicate successful payment event IDs for the same provider payment as processed without duplicating ledger/entitlement writes.\n- Reversal RPC refuses refunds/chargebacks until a provider payment ID is present.\n- Added a service-role-only reconciliation function to detect missing/mismatched gross-sale ledger rows.\n- Static tests assert these protections. Runtime execution remains required.\n\n## Deliberately blocked
- Live checkout, subscriptions, refunds, transfers/payouts, tax invoices, creator payout availability, automatic finance adjustments.
- Provider-specific implementation until provider choice and test credentials are supplied.

- Provider-neutral webhook orchestration now verifies the provider adapter against raw bytes, rejects empty/oversize bodies, applies event freshness checks, hashes raw payload bytes, dispatches payment success to atomic finalization, refunds/chargebacks to reversal, and safely ignores other verified event types. The actual provider signature adapter and HTTP route remain unconfigured until provider selection.
