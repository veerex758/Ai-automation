# Marketplace Phase C — Ecosystem status
Branch: `feat/marketplace-phase-c-ecosystem`, stacked on PR #163 (Phase B lifecycle).

## Implemented foundation
- Additive schema for creator bundles and immutable product-version pins.
- Tenant-scoped private marketplace spaces, member roles, private listings.
- Workspace-bound seat/site/enterprise license records and expiry lifecycle.
- Sponsored promotion records enforce literal `Sponsored` disclosure and approval metadata.
- Privacy-minimized discovery events store actor/query hashes rather than raw search text.
- RLS enabled on all new tables; anon/authenticated direct writes revoked; service role only.
- Bundle catalog API fails closed unless every pinned product version is published/current/approved.
- Sponsored placements endpoint uses separate promotion query/rank, filters active windows and approved current versions, explicitly labels Sponsored, and does not alter organic ranking.
- Private marketplace create/list API requires authenticated user; create checks workspace owner/admin membership and grants creator manager role.
- pgTAP assertions for schema/RLS/direct access restrictions.

## Remaining Phase C acceptance
- Bundle create/edit, immutable manifest version submission, reviewer approval/publish gates, free and paid one-time checkout, 20/80 ledger/reversal, bundle entitlement and verified inactive workflow installation.
- Private member invitation/removal and private listing APIs with workspace membership and product/version approval enforcement.
- Enterprise license issuance/seat management and install/runtime enforcement.
- Promotion creator purchase flow, finance approval/budget accounting, pause/refund, audit, and sponsored ranking/display UI.
- Recommendation/collections/personalized discovery implementation and ranking quality tests.
- Developer API key lifecycle, read/publish scopes, durable rate limits, audit, product draft API, typed SDK package and docs.
- Expanded RLS actor matrix, clean migration replay, pgTAP transaction tests, lint/typecheck/build/CI and staging/browser acceptance.

## Dependencies and safety
Phase B provider sandbox, settlement and payout processing plus Phase A acceptance remain release blockers. No hosted migration, live charges/transfers, credentials or production money actions were used.
