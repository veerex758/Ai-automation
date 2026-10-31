# Durable execution queue (foundation)

This migration introduces a server-owned PostgreSQL queue for Aivanta workflow executions.

## Guarantees in this phase
- **Persistent dispatch:** one server-side transaction serializes each workspace/idempotency key, creates the run and job together, snapshots the exact workflow version/definition, and returns the existing job for duplicate delivery.
- **Worker claims:** claims use row locks with `SKIP LOCKED`, per-attempt lease tokens, and bounded leases. Expired running leases can be reclaimed.
- **Checkpoints:** one durable checkpoint per job/step records status and bounded input/output metadata. This phase records progress but does not yet resume the dry-run executor from a checkpoint; retries re-evaluate the side-effect-free workflow.
- **Retries:** transient failures are rescheduled with capped exponential backoff.
- **Dead letters:** jobs reaching their attempt limit are copied to a separate dead-letter table with a stable error code.
- **Monitoring data:** job status, attempt count, availability, lease, worker ID, and safe error code are queryable by trusted server-side operators.

## Worker endpoint
Deploy the Next.js application with a server-only `CRON_SECRET` (or `AIVANTA_WORKER_SECRET`) and Supabase service key. Invoke `POST /api/internal/worker` with `Authorization: Bearer <secret>`. The worker processes at most five jobs per tick.

The worker currently executes **side-effect-free workflow dry-runs only**. The synchronous Resend live-run route is intentionally not redirected into this queue in this foundation change: live external effects need a provider-aware idempotency/reconciliation design before retrying after an uncertain worker crash. Do not enable live email retries through this worker.

## Verification gates before production
1. Apply the migration to an isolated development database only after the migration-history reconciliation PR is merged and clean replay succeeds.
2. Enqueue two jobs with the same workspace/idempotency key; assert one row and one job ID.
3. Run two workers concurrently; assert a job is leased to only one worker.
4. Kill a worker after claim; wait for lease expiry; assert another worker reclaims the job with an incremented attempt.
5. Deliver the same event twice; assert unique dispatch and one run.
6. Force transient errors; assert bounded backoff and retry count.
7. Force permanent errors; assert dead-letter copy and terminal job status.
8. Verify a checkpoint survives worker restart; step-level resume is not claimed in this phase.
9. Verify non-member clients cannot select or mutate queue, checkpoint, or dead-letter tables.
10. Confirm no real provider side effects are enabled by this worker.

## Operational limits
- The worker is invoked by an external scheduler; this PR does not provision a continuously running process.
- Queue tables and RPCs are service-role only.
- Dispatch creation and successful run finalization are transactional and lease-checked. A job can be safely retried only if its actions are side-effect-free or individually idempotent. Provider actions remain out of scope for this worker until reconciliation semantics are implemented.
- Dead-letter replay UI and operator controls are a follow-up.


## PostgreSQL failure-injection coverage

The CI workflow provisions an isolated PostgreSQL 16 service named `aivanta_test` and runs `tests/durable-execution-postgres.test.mjs` through `npm test`. The suite applies the queue migration to a minimal fixture schema and exercises concurrent `SKIP LOCKED` claims on separate connections, simultaneous duplicate dispatch, abandoned worker lease recovery, retry exhaustion/dead-letter/run failure, and denial of queue-table/RPC access to `anon` and `authenticated`. The integration harness refuses to run destructive setup unless `AIVANTA_TEST_DB=1` and the database name is exactly `aivanta_test`. It does not connect to staging or production.
