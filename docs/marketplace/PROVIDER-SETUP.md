# Marketplace provider configuration (staging only)

## Checkout and webhooks
- `PAYSTACK_SECRET_KEY`: use a Paystack test secret for sandbox.
- `PAYSTACK_MARKETPLACE_MONTHLY_PLAN` / `PAYSTACK_MARKETPLACE_YEARLY_PLAN`: Paystack test plan codes. Checkout validates plan amount, currency and interval against server-priced product data before initializing.
- `STRIPE_SECRET_KEY`: use Stripe test key.
- `STRIPE_MARKETPLACE_WEBHOOK_SECRET`: endpoint signing secret for `/api/marketplace/webhooks/stripe`.
- Paystack webhook endpoint: `/api/marketplace/webhooks/paystack`; Stripe: `/api/marketplace/webhooks/stripe`.
- Use test provider dashboards to configure signed webhook events. Never put secrets in client env or logs.

## Creator payouts/refunds
- `AIVANTA_MARKETPLACE_REVIEWER_IDS`: comma-separated user UUIDs explicitly authorized for finance/reviewer routes.
- `AIVANTA_MARKETPLACE_PAYOUTS_ENABLED=true`: explicit gate for initiating transfers; leave unset/false until finance authorizes provider test accounts and sandbox review.
- `AIVANTA_MARKETPLACE_REFUNDS_ENABLED=true`: explicit gate for initiating provider refunds; refunds remain pending until signed provider event reverses the ledger and entitlement.
- Paystack payout profiles must use verified recipient codes; Stripe profiles must use verified connected-account IDs. Country, onboarding, tax, payout enabled and hold checks run before transfer.
- Never use production credentials during CI or staging tests. A transfer initiation is not settlement; only provider-confirmed settlement reconciles the payout ledger.

## Subscription lifecycle
- Stripe Checkout uses recurring monthly/yearly price data and metadata linking the marketplace subscription.
- Paystack recurring checkout requires plan codes matching the product's exact USD amount and interval.
- Signed invoice/subscription events feed the idempotent subscription event RPC. Past-due grace is seven days; cancellation/expiry revokes entitlements.
- Provider sandbox integration tests and end-to-end credentials are required before release.
