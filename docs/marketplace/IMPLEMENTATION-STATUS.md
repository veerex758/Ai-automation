# Marketplace Phase A–C implementation and acceptance ledger

Source of truth: `docs/marketplace/MASTER-SPEC.md`. This ledger separates merged implementation from this PR and from acceptance still outstanding. A route/schema alone is not release acceptance.

## Phase A — launch baseline

| Blueprint item | State | Evidence / remaining acceptance |
|---|---|---|
| Catalog, search/filter/category/sort/pagination; product detail | Implemented on main | `/api/marketplace/catalog`, catalog tests, public-version view. Authenticated/browser journey still required. |
| Creator profiles/storefront, creator application/status | Implemented on main | Creator/profile APIs and creator gate tests. Identity/KYC remains external/provider dependent. |
| Immutable product versions/private artifact storage/checksum | Implemented on main | Version submission, private bucket and integrity/hash verification. |
| Automated checks + reviewer exact version/hash approval + publication gate | Implemented on main | `lib/marketplace/verification.ts`, reviewer queue/decision/publish RPC, verification tests. Reviewer must remain independent of creator. |
| Customer install into own workspace, inactive draft copy | Implemented on main | Install RPC + private artifact materialization. No execution on install. |
| Configure connections, dry-run, activate, pause, update/rollback/version pin, uninstall | Partial | Configure/dry-run/activation/pause/rollback/uninstall customer journey and backend transition gates need completion and authenticated E2E. |
| Product ratings eligible only after purchase/install | In PR #175 | Rating API/table, RLS, one review per product/user, published-only display. CI/replay pending. |
| Abuse/IP/security/privacy reports + moderation | In PR #175 | Report submission, moderator queue, audited triage/closure, reporter notice. CI/replay pending. |
| Customer notices (permissions/integrations/usage/revocation/updates) | Foundation in PR #175 | Inbox/read state; actual notice fan-out on product/version/revocation events still needs wiring. |
| Creator analytics views/install/conversion/gross/refunds/earnings/subscriptions | Implemented foundation on main | Analytics RPC/route; event completeness and conversion-quality acceptance pending. |
| Admin/reviewer moderation, creator suspension, product emergency revoke/customer notification | Partial | Creator and product moderation primitives exist; full emergency installation/runtime revoke and notification propagation not yet accepted. |
| Creator/customer legal policies, support/refund and appeal journey | Partial | Support/refund foundations exist; public policy acknowledgement and full appeal/support journeys remain. |

## Phase B — creator monetization

| Blueprint item | State | Evidence / remaining acceptance |
|---|---|---|
| Provider checkout, signed webhook, idempotent purchase + entitlement | Implemented foundation on main | Paystack/Stripe adapters, atomic finalization, webhook processing tests. Provider sandbox checkout still unexecuted. |
| 20/80 ledger, refunds/reversals/chargebacks | Implemented foundation on main | Append-only financial ledger and reversal/reconciliation tests. Live provider statement matching is external acceptance. |
| Creator earnings/balance/statements/payout requests | Implemented on main | Creator earnings/payout APIs, SQL ledger RPCs and finance review. |
| Creator payout profile/onboarding/tax/eligibility/holds | Implemented gate foundation | Payout profile, verified/tax/hold checks; actual provider KYC is country/account dependent. |
| Provider transfer initiation and payout reconciliation | Implemented gated foundation | Paystack/Stripe transfer route; transfer feature flag off by default; provider settlement confirmation/reconciliation and failure/retry acceptance require sandbox credentials. |
| Marketplace subscriptions/cancellation/renewal/failed payment/entitlement expiry | Implemented foundation on main | Subscription checkout, webhook lifecycle, cancellation RPC and grace/retry state. Recurring sandbox renewal/cancel/upgrade/proration/refund acceptance still outstanding. |
| Advanced creator conversion/retention analytics, support/appeals | Partial | Analytics/support cases foundation; full funnel and SLA/notification workflow pending. |

## Phase C — ecosystem and growth

| Blueprint item | State | Evidence / remaining acceptance |
|---|---|---|
| Bundles/packs, immutable pins, verification, checkout, entitlement/install/refund | Implemented foundation on main | Bundle APIs, payment/entitlement RPCs, Phase C DB tests. Full buyer journey/browser acceptance pending. |
| Premium AI agent products | Partial | Product type and catalog can represent agent; distinct agent runtime, capability isolation, usage metering and agent-specific acceptance not proven. |
| Creator/agency teams/collaborators/shared ownership | In PR #175 | Creator team and member management foundation, owner/admin roles, audit, RLS. Product-level collaborator permissions/shared publishing still outstanding. |
| Private org marketplaces, allowlists/private distribution | Implemented foundation on main | Private spaces/members/listings APIs. Invitation, removal and real organization E2E acceptance pending. |
| Enterprise licensing, seats, procurement/policy/usage/compliance exports | Partial | License/seat/issuance/install gates exist; policy enforcement, usage analytics, procurement and compliance export incomplete. |
| Discovery/recommendations/personalized collections | Partial | Search/discovery events and promoted listing foundations; ranking, collections and personalization not complete. |
| Sponsored placements/disclosure/budget/review/refund | Implemented foundation on main | Sponsored label/ranking separation and budget/review/refund gates. Creator purchase/finance/browser acceptance pending. |
| Developer API/SDK, keys/scopes/rate limits/audit | Implemented foundation on main | API key lifecycle, v1 route, SDK and rate-limit/audit migrations; publish/draft endpoint coverage and external developer acceptance pending. |

## Release blockers / gates (all phases)
- PR #175 must pass CI, migration replay, database service checks; merge only after exact head is green/mergeable.
- Review every new migration and replay from clean local database; **no hosted Supabase migration has been applied by this work**.
- Provider sandbox credentials/eligible Paystack USD and Stripe accounts, KYC/tax, webhook setup and verified statements are needed for actual payment, subscription and payout tests. Checkout/payout/refund live flags remain off unless explicitly authorized.
- Authenticated staging/browser E2E is blocked until Vercel deployment quota is available; old preview does not contain current main.
- Public launch is not certified until all MASTER-SPEC acceptance tests pass and a release report records evidence and external blockers.
