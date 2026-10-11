# Scheduled workflow foundation

## Scope of this slice

- Persist one interval schedule per workflow, scoped to its workspace.
- Limit intervals to 15 minutes through 7 days.
- Atomically claim due, enabled schedules only when the workflow is active and its first trigger is configured as `schedule`.
- Use short leases and `FOR UPDATE SKIP LOCKED` so concurrent dispatcher ticks do not claim the same schedule simultaneously.
- Require the current lease token to finish a claim.
- Apply bounded retry backoff and store only a safe error code.

## Deliberate limitations

This migration is infrastructure, not a deployed scheduler. It does not execute a workflow, send email, or invoke external services. A trusted server-side dispatcher and execution adapter must be implemented and tested before scheduled workflows are enabled in production. A database migration being present in GitHub does not mean it has been applied to the connected Supabase project.

## Verification gates

1. Apply the migration to a non-production Supabase environment.
2. Test two concurrent claim requests and confirm a schedule is claimed only once.
3. Verify expired leases can be reclaimed and stale tokens cannot finish newer claims.
4. Test successful interval advancement and failed-run backoff.
5. Add the trusted dispatcher, authenticated worker flow, and run-history persistence.
6. Keep live external side effects disabled until staging end-to-end tests pass.
