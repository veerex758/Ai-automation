# Aivanta Marketplace — Master Product & Delivery Specification

This is the authoritative marketplace scope. Implementation tickets, PRs, migrations, and release gates must map to this document. Nothing below is considered complete merely because a UI exists; behavior must be enforced by the backend and tested.

## Locked business decisions
- Global availability from launch (subject to provider, sanctions, tax, and legal country restrictions).
- Both Aivanta and independent creators may publish.
- Mixed product pricing: free, one-time purchase, and recurring subscriptions.
- Aivanta commission: 20% of eligible product revenue; creator share: 80% before payment fees, tax, refunds, chargebacks, and other explicitly disclosed adjustments.
- Creator retains ownership of original automation/product content; Aivanta owns marketplace infrastructure, platform code, and verification systems.
- Marketplace launches with Aivanta; public listings are always Aivanta-verified.
- Verification is mandatory for every product and every version; no unverified product can be listed, purchased, or installed.

## Marketplace roles
- Customer/buyer: browse, evaluate, buy, install, configure, dry-run, activate, pause, update, uninstall, review, report, refund-request.
- Creator: onboard, establish creator profile, submit products/versions, see verification feedback, respond to change requests, publish approved versions, manage listings, track sales/earnings, and request payout.
- Aivanta reviewer: run/review checks, approve/reject/request changes, publish/suspend/revoke, investigate reports, require reverification.
- Marketplace finance operator: reconcile payment events, commissions, refunds, chargebacks, payout failures, and adjustments.
- Platform admin: categories, featured products, creator moderation, listing moderation, audits, access control, incident response.

## Phase A — Launch baseline (required for marketplace public launch)
### Customer marketplace
- Marketplace landing/catalog; search; filters; categories; product type and pricing filters; sorting; pagination.
- Product detail: summary, long description, creator, version, changelog, integrations, permissions/scopes, plan requirements, usage expectations, price, subscription interval, verification status/scope, support and refund policy.
- Creator profile/public storefront, verified badge and approved listings.
- Product reports, reviews/ratings after eligible installation/purchase, abuse moderation.
- Free install and paid checkout; purchase history; receipt; entitlement status; refund-request flow.
- Workspace install flow: copy verified artifact into workspace; never import creator credentials; map required connections; configure; dry-run; activation confirmation; installation lifecycle (configure/ready/active/paused/removed); updates and rollback/version pinning; uninstall.
- Customer notices for permissions, external effects, required integrations, usage limits, changes, verification revocation, and product updates.

### Creator studio
- Creator application/profile and status (pending/verified/suspended); identity and payout onboarding gates.
- Product creation/editing; category; workflow/pack/agent type; free/one-time/recurring price; USD launch pricing; summary/details; requirements; permissions; integrations; usage; screenshots/media; support and changelog.
- Versioned immutable artifact submissions, artifact checksum, private package storage, draft/submission states.
- Automated preflight feedback; review queue status; reviewer notes; changes-requested/resubmission; release/publish controls only after approval.
- Creator analytics: views, installs, conversion, gross sales, refunds, commission, net earnings, subscriptions, payout status.

### Verification and publication (non-negotiable)
- Automated checks: schema; registered node/action/provider existence; input/configuration validation; graph integrity; expressions; trigger/branch/loop/retry/delay semantics; missing integrations; permissions/scopes; secret/credential scanning; prohibited behavior; unsafe network/external actions; package integrity; sandbox/dry-run; resource limits; data handling disclosures.
- Human review of the exact immutable version and automated report; reviewer is not the submitting creator.
- Approval is bound to product + version + artifact hash + check results + reviewer + timestamp.
- New version is pending and cannot inherit approval. Every update requires automated checks and human review.
- Backend gates public catalog, checkout, entitlement grant, install, and activation on published product + approved current version.
- Aivanta may request changes, reject, suspend, revoke verification, remove listings, or require reverification.
- Verification badge must explain reviewed version/scope/limitations and must not promise absolute safety.
- Reviewer actions require allowlisted/role-based permissions, audit records, and stronger authorization for suspension/revocation.

### Administration and trust & safety
- Admin review queue, artifact/manifest inspection, check results, sandbox run, approve/reject/request changes/publish, suspend/revoke/reverify.
- Creator identity/status moderation, appeals, creator suspension and reinstatement.
- Product reports, abuse/IP/security complaints, reviews moderation, category management, featured listings, search quality.
- Financial overview, commission reconciliation, refunds, chargebacks, payout failures, authorized adjustments.
- Immutable audit log for reviewer, admin, moderation, verification, listing, payment, refund, and payout actions.
- Emergency response: disable/suspend product, revoke installations or prevent execution where security warrants, notify affected customers, preserve audit evidence.
- Prohibited: credential theft, malware/destructive workflows, unauthorized extraction, spam, fraud, hidden external actions, misrepresented capabilities, stolen IP, security bypasses.

### Financial integrity (launch baseline)
- Provider abstraction for checkout, subscriptions, payment webhooks, refunds, chargebacks, receipts, and payout rails; select and configure provider before live transactions.
- Checkout is server-created from verified current product/version and exact price/currency; never trust browser amount.
- Signed webhook verification; idempotency by provider + event ID; durable event inbox; replay-safe processing.
- Purchase and entitlement creation atomically on verified payment success; no entitlement on pending/failed.
- 20% Aivanta commission; creator 80% before clearly itemized processing/tax/refund/chargeback adjustments.
- Append-only financial ledger: gross sale, platform commission, creator earnings, processor fees, tax, refunds, reversals, chargebacks, payout.
- Reconciliation against provider balance/transactions; duplicate events cannot duplicate sales, entitlement, commission, or payout.
- Refund and chargeback state changes; entitlement revoke/adjustment; creator/platform ledger reversal; dispute evidence workflow.
- Subscription lifecycle: renewals, cancellation, grace periods, failed-payment retries, entitlement expiry, upgrades/downgrades, proration policy, refund policy.
- Creator payouts: verified identity, payout account, eligibility/hold period, minimum threshold, payout batches, provider transfer IDs, failed payout retries, reconciliation, statements and tax/compliance requirements.
- Never imply creator payouts are available until payout provider/country eligibility and onboarding are verified.

## Phase B — Creator monetization expansion
- Full creator verification and payout onboarding.
- Creator earnings, balance, statements, payout history, tax/compliance details and payout support.
- Creator payout processing and reconciliation.
- Marketplace subscriptions and subscription management beyond one-time product purchases.
- Advanced sales/conversion analytics, creator support and appeals.
- Refund/chargeback and subscription retention tooling.

## Phase C — Marketplace ecosystem and growth
- Automation bundles/packs and cross-product bundles.
- Premium AI agents and agent products.
- Creator/agency subscriptions and enterprise licensing.
- Private/organization marketplaces, allowlists and private distribution.
- Advanced discovery, recommendations, personalized categories and collections.
- Promoted listings/sponsored placements with disclosure and ranking integrity.
- Agency publishing, teams, collaborators, shared ownership/permissions.
- Enterprise procurement, licensing, policy controls, usage analytics, compliance exports.
- Advanced marketplace analytics, API/SDK publishing, developer ecosystem.

## Security and data isolation
- RLS for every marketplace table; explicit anonymous, buyer, creator, reviewer, workspace-member, nonmember, and service-role tests.
- Artifacts remain private; public endpoints expose only reviewed display metadata and approved current-version facts.
- Server/service role only for approval, publication, payment/entitlement, installation/activation, refunds, ledger, payout and privileged moderation.
- Workspace install verifies membership, active entitlement, product/version approval, workspace plan, declared scopes, and connection ownership.
- Customer OAuth/API credentials never appear in creator packages, logs, marketplace downloads, or another workspace.
- Customer installation is a workspace-owned copy, version-pinned and auditable; customer may configure and dry-run before activation.
- Secrets and personal data are redacted; logs are safe; rate limits and payload limits on submission, checkout, webhook and moderation endpoints.
- Signed webhook + timestamp validation, replay protection, deduplication, rate limits and incident alerting.
- Admin/reviewer allowlist or RBAC with least privilege, audit trail and emergency revoke.
- Legal policy: creator terms, IP/license, privacy/data handling, refund, payout/tax, prohibited-use and security disclosure.

## Required acceptance tests
1. Anonymous user sees only published products with approved current versions and public metadata; never private manifests/artifacts.
2. Creator cannot self-verify, publish, approve own version, or modify approved artifact.
3. Product with pending/rejected/revoked version cannot list, checkout, install, or activate.
4. New version immediately requires fresh verification and cannot inherit prior badge.
5. Reviewer approval is bound to exact version and artifact hash; publication is a separate action.
6. Checkout amount comes from server catalog, not user request; payment webhook is signed and idempotent.
7. Duplicate payment event cannot double-create purchase, entitlement, ledger entries, commission or payout.
8. Refund/chargeback correctly updates purchase, entitlement and creator/platform financial ledger.
9. Creator payout totals reconcile to ledger, commission and provider transactions.
10. Workspace nonmember cannot read/install; workspace member without entitlement cannot install paid product.
11. Installation is initially configuring/inactive, uses customer's own connections, and requires successful dry-run + activation.
12. Suspend/revoke blocks new installs and defined runtime behavior; affected customers receive notice.
13. Migration replay from clean database, lint, typecheck, unit/integration tests, CI, authenticated staging and browser E2E pass before release.
14. Release report lists verified, blocked, unimplemented, and externally dependent items; never mark a feature complete based on UI-only mock.

## Delivery sequencing
- Marketplace Phase 1: schema/RLS, catalog, creator submission, immutable artifact/version, verification queue/admin, publication gates, private storage, install entitlement checks, test foundation.
- Marketplace Phase 2: checkout/payment provider, idempotent webhook, purchases, entitlement lifecycle, 20% commission ledger, refunds/chargebacks.
- Marketplace Phase 3: creator earnings and payout onboarding/processing, subscription renewals, finance reconciliation.
- Marketplace Phase 4: reviews/reports/moderation, advanced admin and trust tooling.
- Marketplace Phase 5: packs/agents, private marketplace, enterprise/agency, promoted listings and advanced discovery.
- All phases remain under the launch requirement that every public product is verified; phases describe delivery order, not permission to bypass trust/security.

## Release gates
- Branch/PR per phase; no direct main commits.
- Reversible reviewed Supabase CLI migrations; no production application without explicit approval.
- Tests, lint, typecheck and clean migration replay before merge.
- Browser/staging verification only when deployment capacity is available; explicitly mark blocked when unavailable.
- No live payment/payout/provider actions until provider, credentials, compliance, and user authorization are confirmed.
