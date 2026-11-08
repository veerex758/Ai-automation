# Marketplace Phase 3 — delivery/verification ledger

Scope source: `docs/marketplace/MASTER-SPEC.md`, Phase B (Creator monetization expansion).
Branch: `feat/marketplace-phase-3-creator-monetization`, PR #163.

## Phase B coverage

| Blueprint item | Delivery | Gate / limitation |
| --- | --- | --- |
| Creator verification and payout onboarding | Provider-neutral payout profile; country, onboarding/tax status, enabled flag, minimum, hold and verified time; creator-safe read RPC | Provider-hosted identity/KYC onboarding and live account linking remain external integration work |
| Earnings, balance, statements and payout history | Ledger-derived earnings/balance; immutable period snapshots/cutoff; own payout/statement read RPCs; CSV statement export | Finance must generate snapshots; no fabricated statements |
| Tax/compliance details and payout support | Payout profile status is surfaced privately; creator support cases cover tax, verification, payout and ledger appeals | No tax filing or KYC document storage; provider owns sensitive identity records |
| Payout processing/reconciliation | Finance review state machine; gated Paystack/Stripe transfer initiation, durable provider statement reconciliation (matched/mismatch/unknown/duplicate), transfer uniqueness/idempotency and atomic payout ledger debit | Provider credentials and sandbox statements/transfer webhooks remain required; explicit payout env gate stays off by default |
| Subscription renewals and management | Subscription event inbox, event dedupe/conflict/order protection, Stripe recurring Checkout, Paystack plan-validated recurring checkout, signed subscription event processing, renewal/version pinning, 7-day past-due grace, cancellation intent/outbox and private buyer listing | Sandbox provider event fixtures and actual provider cancellation API/credentials still required |
| Advanced sales/conversion analytics | Ledger-backed sales, gross, commission, creator earnings, reversal, active/past-due subscription metrics | Conversion funnels need impression/click tracking and privacy-reviewed event retention; not inferred from sales |
| Creator support and appeals | Durable private case records, idempotent create/read APIs, payout ownership validation and dashboard history | Staff triage/reply tooling and SLA notifications are not yet delivered |
| Refund/chargeback and retention tooling | Phase 2 payment reversal ledger and entitlement updates; subscription past-due/grace lifecycle | Retention cohort/notification tooling remains future work |

## Verification checklist

- [ ] Clean migration replay succeeds through all Phase 3 migrations (current replay failure investigated/fixed; rerun pending).
- [ ] pgTAP financial, subscription, payout and creator-support transactions pass.
- [ ] Workflow validation tests, lint, type-check and build pass at the exact PR head (earlier run failed; fixes are in branch, new exact-head run pending).
- [ ] Authenticated staging and browser checks (blocked until deployment capacity is available).
- [ ] Provider sandbox recurring billing, payout onboarding and transfer reconciliation (external credentials/provider approval required).
- [ ] Final Phase B verified/blocked/unimplemented report reviewed before merge.

## Safety boundary

No staging/production migration apply, provider charges, transfers, or external account actions are performed by this PR. A payout request reserves ledger balance; only a separately verified provider settlement is recorded as paid.
