# Protected scheduler cadence and verification

## Runtime safety

The Vercel Cron job calls the protected `/api/internal/scheduler` route once daily at 09:00 UTC. The route requires the server-only `CRON_SECRET` (or the configured scheduler secret) as a bearer token and refuses requests without it.

The scheduler only claims due schedules and enqueues immutable workflow snapshots. The durable worker currently performs side-effect-free dry-runs for scheduled workflows; a successful scheduler tick does not mean email, Slack, webhook, or other provider actions ran live.

## Verification boundary

- Do not enable live provider execution to verify the cron route.
- Verify authorization and schedule-claim behavior on an approved non-production environment before enabling any production schedule.
- Vercel Cron deployment behavior is separate from local/API tests. Do not deploy to production solely to test this configuration.
- The once-daily cadence is a conservative baseline. Increase frequency only after confirming the Vercel plan supports it and the workspace scheduling requirements justify it.

## Required server configuration

- `CRON_SECRET`: high-entropy bearer secret available only to the protected deployment.
- Supabase service-role credentials used by the scheduler must remain server-only and use the existing `CODED_SUPABASE_*` runtime fallback configuration.

Never expose the cron secret to the browser or include it in logs.
