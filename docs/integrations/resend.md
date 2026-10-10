# Resend email integration

Aivanta's first live provider is [Resend](https://resend.com). This integration is deliberately opt-in and only supports one email action per manual-trigger workflow in this first release.

## Server configuration

Add these variables to the **server/runtime environment** (for example, the hosting provider's server-side environment settings):

- `RESEND_API_KEY` — a Resend API key. Prefer a sending-only key where available.
- `RESEND_FROM_EMAIL` — a sender address or display-name form that is verified with Resend, such as `Aivanta <hello@example.com>`.
- `AIVANTA_LIVE_EMAIL_RECIPIENTS` — comma-separated allowlist of approved recipient addresses. Live runs cannot send to addresses outside this list.
- `AIVANTA_LIVE_EXECUTION_ENABLED` — set to the exact string `true` only when you are ready for live email actions.

Restart/redeploy after setting environment variables. Never use a `NEXT_PUBLIC_` prefix for these values, and never commit the key to Git.

Live execution stays disabled if any required setting is missing. Keep the recipient allowlist as narrow as possible. The API also limits each authenticated user to 10 live runs per hour.

## Run a live email workflow

1. Save a valid workflow definition.
2. Set the trigger to **manual**.
3. Add exactly one action with provider **email** and operation **send_email**.
4. Set a recipient included in `AIVANTA_LIVE_EMAIL_RECIPIENTS`, a short step title (used as the subject), and the message text.
5. Activate the workflow.
6. Review the live integration status in the builder, then explicitly select **Run live email**.

The request must be authenticated and includes an idempotency key. Repeated requests with the same key do not send a second email. The run and step statuses are persisted in workspace-scoped history.

## Current limits and safety

- Live execution is disabled by default.
- Only manual-trigger workflows are supported for live runs.
- Only one action is allowed per live run, and that action must be a Resend email.
- The recipient must be included in the server-configured allowlist.
- Slack, webhook, internal task actions, schedules, and event triggers remain dry-run only.
- Email is a real external side effect. Verify the recipient and message before selecting **Run live email**.
- A provider timeout or database error can leave a run needing review. Check run history before retrying; never assume a timeout means no email was accepted.
- Provider API keys remain on the server. Aivanta does not return or log the key or raw provider error bodies.
- Aivanta does not yet offer per-workspace provider credentials or automatic background triggers.

## Troubleshooting

- **Integration setup required:** check that all four environment variables are present and that `AIVANTA_LIVE_EXECUTION_ENABLED` is exactly `true`.
- **Recipient blocked:** add the address to `AIVANTA_LIVE_EMAIL_RECIPIENTS` on the server and redeploy.
- **Sender rejected:** verify the sender domain/address in Resend and check `RESEND_FROM_EMAIL`.
- **Provider rate limit:** wait and retry only after checking the saved run record.
- **Workflow not active:** activate it before a live run.
