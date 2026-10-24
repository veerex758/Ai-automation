# Scheduler staging verification

## Safety boundary

The scheduler currently executes scheduled workflows through the dry-run engine only. A successful scheduler tick is not evidence that email, Slack, or webhook actions ran live. Do not enable live execution as part of this verification.

Vercel Cron jobs are configured for production deployments; do not deploy this change to production solely to test cron. Verify the protected route against the approved, protected staging/preview deployment first using a manual request from an authorized operator or CI job. Never paste a secret into a ticket, terminal transcript, or browser URL.

## Required server environment

Configure these only in the intended environment:

- `CRON_SECRET`: high-entropy random value used to authenticate the cron request. Vercel sends it as `Authorization: Bearer <CRON_SECRET>`.
- `NEXT_PUBLIC_SUPABASE_URL`: URL for the dedicated Aivanta staging Supabase project.
- `SUPABASE_SECRET_KEY` (preferred) or `SUPABASE_SERVICE_ROLE_KEY`: server-only key for scheduler RPCs. Never use a publishable/anon key here.

Do not add real values to `.env.example`, GitHub issues, PR descriptions, or logs. Keep live email disabled and do not set `AIVANTA_LIVE_EXECUTION_ENABLED=true` for this test.

## Verification procedure

1. Confirm the target hostname is the approved protected staging/preview deployment and is not a production alias.
2. Confirm the scheduler migration/RPCs are present in the intended staging database and schema/migration parity has been reviewed. Do not reset the database or rewrite migration history.
3. Confirm the environment above is configured for that preview deployment without displaying the secret values.
4. Send a request to `POST /api/internal/scheduler` with `Authorization: Bearer <CRON_SECRET>` from an approved operator/CI environment. Do not include the secret in the URL.
5. Expected outcomes:
   - Missing/wrong authorization: HTTP 401 when a secret is configured.
   - Missing scheduler auth configuration: HTTP 503.
   - Valid request with configured database: HTTP 200 with bounded `claimed`, `succeeded`, and `failed` counts, or a documented generic database/claim error.
   - Responses include `x-request-id` and `Cache-Control: no-store`.
6. If harmless due schedules exist, confirm only dry-run records are created and no provider side effects occur. Do not create or activate a live external-action workflow for this check.
7. Review run history and operational logs using request ID and allow-listed status/error codes only. Never record tokens, authorization headers, workflow inputs/outputs, provider payloads, or customer secrets.
8. Record target environment, exact deployment/commit, HTTP status, request ID, and sanitized result counts in the shared verification ledger.
9. Stop if the hostname, deployment protection, database project, or scheduler RPC state is uncertain.

## Rollback

Revert this PR to remove the cron declaration and this procedure. Removing the declaration prevents future cron scheduling after the corresponding deployment configuration is applied; it does not delete existing run-history rows or undo scheduler ticks that already occurred. Keep the endpoint's authentication gate in place.
