# Protected scheduler cadence and verification

## Runtime safety

Vercel Schedules invokes the protected `/api/internal/scheduler` route every 30 minutes and `/api/internal/worker` hourly. Both routes require Vercel's `CRON_SECRET` bearer header. The scheduler and worker also have independent environment gates:

- `AIVANTA_WORKFLOW_SCHEDULER_ENABLED=true` enables schedule claims in that environment.
- `AIVANTA_DURABLE_WORKER_SCHEDULE_ENABLED=true` enables the periodic worker recovery sweep.
- `AIVANTA_SCHEDULED_LIVE_EXECUTION_ENABLED=true` together with `AIVANTA_LIVE_EXECUTION_ENABLED=true` opts scheduled workflows into live mode. Otherwise scheduled workflows are queued as dry-runs.

A successful scheduler tick means the immutable active workflow version was durably queued and its schedule lease finalized. It does not, by itself, prove a live provider action succeeded. The scheduler immediately wakes the durable worker after queueing.

## Verification boundary

- Keep all three flags off in Preview until authenticated staging configuration and test data are ready.
- First enable the scheduler and worker flags in the approved staging environment with scheduled live execution disabled. Verify due schedule claims, queue dispatch, worker wake, run history, retry state and next-run advancement.
- Test live scheduled execution only with an agency-approved test workflow and recipient. Enable `AIVANTA_SCHEDULED_LIVE_EXECUTION_ENABLED` only after the manual and signed-webhook gates pass.
- Legacy workflow definitions remain dry-run-only for scheduled execution. Live scheduled execution requires the registered workflow format and the normal live-operation allowlist.
- Vercel Schedules run every 30 minutes for schedule dispatch and hourly for abandoned-lease recovery. Together this uses 2,160 runs per 30-day month per environment; even Production plus Preview remains below the 5,000 monthly Hobby allowance.
- Do not call the scheduler production-ready until real staging schedule claims and the corresponding run trace have been inspected.

## Required server configuration

- `CRON_SECRET`: high-entropy bearer secret available only to the protected deployment. Vercel Schedules supplies it to path targets.
- Supabase service-role credentials used by the scheduler must remain server-only and use the existing `CODED_SUPABASE_*` runtime fallback configuration.

Never expose the cron secret to the browser or include it in logs.
