# Level 8 — Deployment and MVP launch checklist

This guide prepares Aivanta for a controlled staging deployment. A successful build is not the same as a production launch: hosting, authentication redirects, real email delivery, and a smoke test must be verified in the target environment.

## Current safe defaults

- Keep `AIVANTA_LIVE_EXECUTION_ENABLED=false` until the staging email test has passed.
- Use Aivanta's dedicated Supabase project only: `xymbwkegcpjxlgclqiop`.
- Use a verified Resend sender and a narrow test-recipient allowlist.
- Never put `RESEND_API_KEY`, database passwords, or service-role keys in `NEXT_PUBLIC_*` variables.
- Do not use customer recipients for the first live test.

## Hosting configuration

Use a Node.js-compatible Next.js host. Configure the following variables in the host's server/runtime environment:

| Variable | Required | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Aivanta project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes | Publishable key only |
| `RESEND_API_KEY` | For email | Server-only, sending-scoped key preferred |
| `RESEND_FROM_EMAIL` | For email | Sender verified in Resend |
| `AIVANTA_LIVE_EMAIL_RECIPIENTS` | For email | Comma-separated test addresses |
| `AIVANTA_LIVE_EXECUTION_ENABLED` | Yes | Keep `false` for initial deployment |

Do not commit environment files or paste secret values into pull requests, issues, logs, or chat.

## Before deploying

1. Confirm GitHub Actions passes tests, lint, type-check, and production build on `main`.
2. Deploy a preview/staging environment before production.
3. Configure Supabase Auth's site URL and redirect allow-list for the actual deployment host. Include the exact `/auth/callback` redirect URL.
4. Verify login, sign-up confirmation, sign-out, dashboard protection, workflow creation, dry-run, and run-history loading.
5. Confirm the health endpoint returns `200` at `/api/health`. It deliberately reveals no secrets or internal configuration.
6. Confirm Supabase RLS and security advisor status on the dedicated Aivanta project.
7. Keep live email disabled while completing the checks above.

## Controlled live-email smoke test

Only after staging auth and database checks pass:

1. Add a verified sender and one inbox you control to the hosting environment.
2. Set `AIVANTA_LIVE_EXECUTION_ENABLED=true` in staging only.
3. Create and activate a manual-trigger workflow with exactly one email action.
4. Confirm the recipient is in `AIVANTA_LIVE_EMAIL_RECIPIENTS`.
5. Send one clearly labeled test message to that inbox.
6. Confirm the provider result, workflow run, and step history.
7. Retry the same request with the same idempotency key in a controlled test and verify a duplicate is not sent.
8. Turn live execution off again until the launch decision is made.

If a request times out or database persistence fails after the provider call, inspect run history and the provider dashboard before retrying. A timeout does not prove that no email was delivered.

## Production launch gate

Do not call the MVP launched until the production URL and Supabase Auth redirects are configured, the staging smoke test is documented, monitoring/log review is available, backup and recovery expectations are understood, and the owner has explicitly approved enabling live email in production.

Hosting provider, deployment project, domain, and production secrets must be supplied/configured by the project owner; this repository change does not deploy the app or enable live execution.
