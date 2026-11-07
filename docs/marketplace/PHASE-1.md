# Aivanta Marketplace — Phase 1 implementation plan

## Decisions
- Global launch; Aivanta + independent creators publish.
- Free, one-time USD, and recurring product pricing.
- 20% commission; creators own original work, Aivanta platform infrastructure.
- Mandatory Aivanta automated + human verification for every product/version before public listing, purchase, or installation.

## Phase 1 scope
1. Catalog/category discovery and product detail pages.
2. Creator onboarding/profile and product submission.
3. Immutable product versions and private artifact storage.
4. Verification queue, automated checks, reviewer decisions and audit history.
5. Backend publication gate: approved current versions only.
6. Purchase/entitlement primitives (provider checkout/webhooks follow dedicated work).
7. Workspace-scoped installations; customer credentials never travel with creator artifacts.
8. Admin review surfaces, tests, migration replay and CI.

## Verification contract
- Submission creates pending version; automated validation covers schema, registry nodes, expressions, permissions, secret patterns, unsafe operations and sandbox behavior.
- Human reviewer approves the exact immutable version.
- Only trusted server/service-role can approve, publish, or write review outcomes.
- Publication requires approved version; update creates a new version and requires fresh checks + human approval.
- Failed/rejected/suspended/revoked versions cannot be installed.
- Badge identifies verified version and scope; it is not a safety guarantee.

## Security
- RLS on all marketplace tables.
- Creator edits only draft/change-requested products.
- Public catalog only published products with approved current versions.
- Verification, payment and entitlement writes are server-only.
- Workspace installation checks membership and entitlement on server.
- Artifacts remain private; secrets prohibited in packages and scanned.
- Install copies definitions into customer workspace; creator credentials never reused.
- Financial records append-only; webhook idempotency; payout compliance.

## Acceptance gates
- RLS tests for anon, buyer, creator, other creator, workspace member/nonmember, privileged reviewer.
- Unverified product cannot be listed, purchased, or installed.
- Creator cannot approve own product or edit approved versions.
- New version loses approval until reviewed.
- Duplicate webhook cannot duplicate purchases/entitlements/commission.
- Install is workspace-isolated and inactive until configure + dry run.
- Migration replay, lint, typecheck, tests and CI green before PR ready.
- Browser/staging E2E waits for Vercel availability; never claim unrun tests passed.
