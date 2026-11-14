# Aivanta SaaS operations

## Billing providers

Aivanta currently uses prepaid billing periods. A verified payment applies a monthly or annual plan period; it is not a recurring card mandate.

### Paystack
Required:
- `PAYSTACK_SECRET_KEY`
- `AIVANTA_BILLING_CURRENCY` (`NGN` or `USD`)
- `AIVANTA_STARTER_MONTHLY_AMOUNT_MINOR`
- `AIVANTA_STARTER_ANNUAL_AMOUNT_MINOR`
- `AIVANTA_PRO_MONTHLY_AMOUNT_MINOR`
- `AIVANTA_PRO_ANNUAL_AMOUNT_MINOR`
- `AIVANTA_BUSINESS_MONTHLY_AMOUNT_MINOR`
- `AIVANTA_BUSINESS_ANNUAL_AMOUNT_MINOR`

The webhook remains the primary settlement path. The daily reconciliation job verifies older pending Paystack references and applies subscription expiry / scheduled plan changes.

### Stripe
Stripe is enabled only when the secret key, webhook signing secret and a matching active one-time Price are configured for the plan.

Required:
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `AIVANTA_STRIPE_PRICE_STARTER_MONTHLY`
- `AIVANTA_STRIPE_PRICE_STARTER_ANNUAL`
- `AIVANTA_STRIPE_PRICE_PRO_MONTHLY`
- `AIVANTA_STRIPE_PRICE_PRO_ANNUAL`
- `AIVANTA_STRIPE_PRICE_BUSINESS_MONTHLY`
- `AIVANTA_STRIPE_PRICE_BUSINESS_ANNUAL`

Stripe webhook endpoint: `/api/billing/stripe/webhook`.

The configured Stripe Price must be active, one-time, and match the Aivanta plan amount and currency. The app does not silently accept a mismatched Stripe price. Stripe recurring subscription mandates are not enabled by this prepaid-period implementation.

## Reconciliation and lifecycle

- Vercel Cron calls `POST /api/internal/billing/reconcile` daily.
- Set `CRON_SECRET`; the route requires `Authorization: Bearer <CRON_SECRET>`.
- Paystack webhook settlement remains immediate; reconciliation is the recovery path for missed or delayed webhooks.
- Subscription expiry and scheduled downgrades are enforced in entitlement and usage checks as well as by the lifecycle sweep.
- Failed or abandoned payments can be retried from Billing, creating a new payment attempt.
- Verified payment receipts are available from Billing history. They are payment receipts, not tax invoices.

## Usage accounting

- Workflow executions are metered on interactive registry runs and durable dispatches (manual, scheduler and webhook).
- Agent runs reserve both one agent-run unit and one AI credit atomically.
- AI workflow generation reserves one AI-generation unit and one AI credit atomically.
- Reservations serialize per workspace; idempotency keys prevent duplicate durable dispatch charges.
- Usage resets on the first day of each calendar month.

## Workspace administration

- The active workspace is selected through an HttpOnly `aivanta_active_workspace` cookie.
- Every workspace-scoped route validates access through Supabase RLS or a server-side owner/admin check.
- Invitations are token-hash stored, single-use, email-matched and expire after seven days.
- Ownership transfer is owner-only and audited.
- The workspace security policy can restrict administrator invitations. Live external operations remain approval-gated.
- Owners/admins can create workspace custom roles from the Workspaces & team page. Custom roles grant explicit permissions for workflows, integrations, dashboards, billing, members, operations and settings; unassigned members retain the default member permission set. Owner/admin privileges are not reduced by custom-role assignment.

## Operational monitoring

- The workspace Operations page is owner/admin-only.
- Worker heartbeats are emitted by the durable worker.
- Queue counts are exact database counts; recent job samples, dead letters, worker freshness, integration test state and 24-hour execution latency are displayed.
- The Operations page supports email and Slack destinations, event filters and minimum severity. Slack incoming webhook URLs are encrypted with `AIVANTA_CREDENTIALS_ENCRYPTION_KEY` and workspace/destination-bound associated data.
- Email delivery requires `RESEND_API_KEY` and `RESEND_FROM_EMAIL`; configure a verified sender domain with Resend before enabling it.
- `POST /api/internal/operations/alerts` evaluates workspace queue, dead-letter, worker, workflow and provider signals and delivers enabled alerts. It requires `Authorization: Bearer <CRON_SECRET>`. Schedule it from a trusted cron provider at an interval supported by the deployment plan; successful deliveries are deduplicated per destination/event for 15 minutes and attempts are recorded in `workspace_alert_deliveries`.
- Delivery failures are recorded with sanitized error codes; webhook secrets are never returned by the settings API.
