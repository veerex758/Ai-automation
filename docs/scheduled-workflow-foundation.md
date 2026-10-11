# Scheduled workflow foundation

## Implemented in this slice

- Persist one interval schedule per workflow, scoped to its workspace.
- Limit intervals to 15 minutes through 7 days.
- Atomically claim due, enabled schedules only when the workflow is active and its first trigger is configured as `schedule`.
- Use short leases and `FOR UPDATE SKIP LOCKED` so concurrent dispatcher ticks do not claim the same schedule simultaneously.
- Require the current lease token to finish a claim. Long-running workers may renew only an unexpired lease.
- Apply bounded retry backoff and store only a safe error code.
- Provide a secret-protected server route at `/api/internal/scheduler` for bounded dispatcher ticks.
- Persist scheduled dry-run history through an atomic, lease-checked, idempotent database function.

## Deliberate limitations

The dispatcher currently performs **dry-runs only**. It does not send email, make HTTP requests, or invoke other external services. It is not automatically scheduled yet: a trusted cron trigger must be configured separately.

The route requires `CRON_SECRET` (or `AIVANTA_SCHEDULER_SECRET`) and a server-only `SUPABASE_SECRET_KEY` (or legacy `SUPABASE_SERVICE_ROLE_KEY`). Never expose these values through `NEXT_PUBLIC_*` variables.

The scheduling migrations have now been applied to the connected Supabase project and verified: the schedule table exists with RLS enabled, scheduler RPCs are restricted to `service_role`, and there are currently zero schedule rows and zero enabled schedules. The project has no separate Supabase development branch available, so end-to-end staging verification is still outstanding. Do not enable a production cron trigger until the protected worker has been verified and its required server-only environment variables are confirmed.

## Verification gates

1. Reconcile repository migration history with the connected Supabase project without modifying production data.
2. Apply the scheduling migrations to a non-production Supabase environment.
3. Test concurrent claims and confirm a schedule is claimed only once.
4. Verify expired leases can be reclaimed, stale tokens cannot renew or finish newer claims, and retries use bounded backoff.
5. Confirm a scheduled run and all step results persist atomically; retrying the same schedule occurrence must not create duplicate run history.
6. Exercise the protected dispatcher end to end with dry-run workflows only.
7. Configure a cron trigger only after staging checks pass.
8. Keep live external side effects disabled until separate staging end-to-end tests pass.
