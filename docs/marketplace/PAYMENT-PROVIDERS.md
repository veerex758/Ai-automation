# Marketplace provider integration (USD)

Implemented adapters: Paystack (card/USD, account eligibility required) and Stripe Checkout (USD). Both use server-only secrets and the provider-neutral atomic payment processor. No live checkout is enabled by default.

## Server environment

```dotenv
# Marketplace payments — server only; use provider TEST credentials in staging.
# Paystack USD requires merchant/account USD eligibility and card channel enabled.
PAYSTACK_SECRET_KEY=sk_test_or_paystack_test_secret
PAYSTACK_WEBHOOK_SECRET=paystack_test_webhook_signing_secret
# Stripe test mode
STRIPE_SECRET_KEY=sk_test_replace_me
STRIPE_WEBHOOK_SECRET=whsec_replace_me
# Enable checkout only after staging smoke + merchant eligibility checks.
AIVANTA_MARKETPLACE_CHECKOUT_ENABLED=false
```

- Never use NEXT_PUBLIC_ for payment secrets. Keep test keys in staging only; production keys require explicit release authorization.
- Paystack merchant must be approved to accept USD; verify dashboard/account currency capability before activation. A USD request may be rejected for accounts without this feature.
- Stripe test mode accepts USD; production account/country, onboarding, and settlement bank eligibility must be verified separately.
- Configure each provider's webhook endpoint secret independently. Rotate keys and webhook signing secrets immediately after exposure.
- Checkout must load amount, product version, and buyer identity from authenticated server/database context, persist a pending purchase first, and use a stable idempotency key. Never accept amount/currency from browser payload.
- Webhook routes must preserve raw bytes, call adapter signature verification, and invoke the existing service-role atomic finalizer/reversal RPC.

## Webhook event mapping

- Paystack: `charge.success`, `refund.processed` (HMAC-SHA512 `x-paystack-signature`).
- Stripe: `checkout.session.completed`, `charge.refunded`, `charge.dispute.created` (timestamped HMAC-SHA256 `Stripe-Signature`).
- Unknown signed events are acknowledged/ignored; duplicates are protected by provider/event and provider-payment idempotency in the database.

## Not yet launch-approved

Authenticated checkout route and buyer email lookup, webhook HTTP route + durable inbox integration, provider-specific fixture tests, real staging credentials/checkout, settlement balance/fee reconciliation, KYC/country/hold gates, and creator payout eligibility/transfer execution. No funds movement is performed by these adapters.
