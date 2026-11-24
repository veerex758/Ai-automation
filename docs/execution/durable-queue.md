# Durable execution queue (foundation)

This migration introduces a server-owned PostgreSQL queue for Aivanta workflow executions.

## Guarantees in this phase
- **Persistent dispatch:** one server-side transaction serializes each workspace/idempotency key, creates the run and job together, snapshots the exact workflow version/definition, and returns the existing job for duplicate delivery.
- **Worker claims:** claims use row locks with `SKIP LOCKED`, per-attempt lease tokens, and bounded leases. Expired running leases can be reclaimed.
- **Checkpoints:** one durable checkpoint per job/step records status and bounded input/output metadata. This phase records progress but does not yet resume the dry-run executor from a checkpoint; retries re-evaluate the side-effect-free workflow.
- **Retries:** only classified transient failures are rescheduled with capped exponential backoff. Permanent validation, authorization, configuration and provider-rejection errors go directly to dead letter.
- **Dead letters:** jobs reaching their attempt limit are copied to a separate dead-letter table with a stable error code.
- **Monitoring data:** job status, attempt count, availability, lease, worker ID, and safe error code are queryable by trusted server-side operators.

## Worker endpoint
Deploy the Next.js application with a server-only `CRON_SECRET` (or `AIVANTA_WORKER_SECRET`) and Supabase service key. Invoke `POST /api/internal/worker` with `Authorization: Bearer <secret>`. The worker claims one job per pass. A dispatch wake performs at most three bounded passes, waiting 5 seconds and then 10 seconds for eligible retries; it never polls indefinitely.

The worker executes legacy workflows and registry workflows in dry-run mode. Registry-format jobs may execute live registered actions only when the dispatch request explicitly sets mode=live and AIVANTA_LIVE_EXECUTION_ENABLED=true. Live retries are operation-allowlisted. A workflow containing Resend email plus only approved deterministic transforms and Gemini qualification/generation may receive up to three attempts. Resend receives a stable per-job/per-step Idempotency-Key, so a retry after an uncertain email response does not send the same email twice. Gemini can be called again if a crash happens before its checkpoint is persisted, which may incur another model usage charge. Other provider write operations remain single-attempt and are dead-lettered when their outcome is uncertain.

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
- Authenticated manual dispatch schedules an immediate server-side worker wake-up after the dispatch response. A Vercel Schedule sweeps `/api/internal/worker` every 15 minutes for abandoned leases and due retries. The endpoint is environment-gated by `AIVANTA_DURABLE_WORKER_SCHEDULE_ENABLED=true` and requires Vercel `CRON_SECRET`; keep the flag off in Preview until that environment has passed acceptance. The 15-minute schedule uses 2,880 runs per 30-day month, within the 5,000 monthly Hobby Schedules allowance.
- Queue tables and RPCs are service-role only.
- Dispatch creation and successful run finalization are transactional and lease-checked. A pending cancellation wins over an expired lease: the claim RPC finalizes the job as cancelled instead of issuing a new lease. Only provider actions with a verified idempotency contract are eligible for automatic live retry; unknown operations fail closed. Other uncertain live outcomes require provider reconciliation before a new execution.
- Dead-letter operator recovery remains dry-run-only; live dead letters cannot be replayed automatically.



## Registered live execution extension

- Live queue dispatch accepts validated legacy workflow definitions and saved aivanta-registry-v1 definitions. Legacy live support is restricted to one manual-trigger Resend email action; other legacy actions remain unsupported.
- The current visual builder still authors the legacy definition format. Its Run panel is wired to the durable Resend path; a full registry-format authoring UI is a separate follow-up. Registry operations are available to saved registry-format definitions, not automatically selectable in the legacy builder.
- Supported live operations are one legacy manual-trigger Resend email action, or registry-format manual trigger plus registered OpenAI text generation, Gemini text generation, Slack message, and Resend email actions, with no more than four actions in one live workflow. Other operations fail closed.
- Credentials are saved per workspace through /api/integrations/workspace. Only workspace owners/admins can add or replace them. The browser receives connection metadata only; encrypted values are stored in workspace_integration_secrets.
- AIVANTA_CREDENTIALS_ENCRYPTION_KEY must be a base64-encoded 32-byte key. The encrypted credential envelope uses AES-256-GCM and version v1.
- Live dispatch requires an authenticated user, an active workflow, an idempotency key, and AIVANTA_LIVE_EXECUTION_ENABLED=true. Email recipients must also be literal addresses on AIVANTA_LIVE_EMAIL_RECIPIENTS.
- Live jobs default to one attempt. The server requests up to three only when every action is in the explicit retry-safe allowlist and the workflow contains Resend email; the database caps live attempts at three. A stable key `rexnora:<job-id>:<step-id>` is sent to Resend for every email step, including loop iterations. Automatic live retries stop 20 hours after job creation, leaving a safety margin inside Resend's 24-hour idempotency retention. Other provider writes remain single-attempt. The worker writes a started checkpoint before each action and a completion checkpoint after the action; successful checkpoints are skipped on retry.
- The authenticated dispatch route wakes the worker with Next.js after() after the queue transaction commits. The queue remains the source of truth if that wake-up fails; the job stays queued.
- Signed webhook ingress can queue live execution only when `AIVANTA_LIVE_EXECUTION_ENABLED=true` and `AIVANTA_DURABLE_WEBHOOK_LIVE_ENABLED=true`; it applies the same retry-safe operation allowlist. The internal scheduler still uses its dry-run compatibility path and must not be represented as live scheduled execution.
- The new migrations are additive and must be applied only after the base queue/integration migrations are merged and clean replay passes. Do not enable live execution before authenticated staging verification of credential save, dispatch, worker, and run history.

## PostgreSQL failure-injection coverage

The CI workflow provisions an isolated PostgreSQL 16 service named `aivanta_test` and runs `tests/durable-execution-postgres.test.mjs` through `npm test`. The suite applies the queue migration to a minimal fixture schema and exercises concurrent `SKIP LOCKED` claims on separate connections, simultaneous duplicate dispatch, abandoned worker lease recovery, retry exhaustion/dead-letter/run failure, and denial of queue-table/RPC access to `anon` and `authenticated`. The integration harness refuses to run destructive setup unless `AIVANTA_TEST_DB=1` and the database name is exactly `aivanta_test`. It does not connect to staging or production.


## Trigger queue bridge (guarded)

- The internal scheduler dispatches due scheduled workflows into the durable queue using a schedule-occurrence idempotency key, then releases its schedule lease. The queue worker processes the immutable snapshot as a dry-run and owns retries/dead letters.
- Verified webhook ingress can opt into durable queueing with the server-only `AIVANTA_DURABLE_WEBHOOK_DRY_RUN_QUEUE_ENABLED=true` flag. This path persists a dry-run job and returns a queued receipt; it does **not** perform provider side effects. Duplicate delivery retries the same idempotent queue RPC so a receipt cannot permanently strand an event after a transient dispatch failure.
- Keep the webhook queue flag disabled until the additive queue migration is applied and authenticated staging acceptance passes. The existing synchronous live webhook path remains separate; it is not claimed to be durably recoverable after uncertain provider acceptance.
- Scheduled and webhook queue registry definitions are validated and simulated without provider calls. Manual registry dispatch may execute the explicitly allowed live operations described above.

## Dead-letter operator recovery

- Owners and workspace admins can inspect recent dead-letter metadata at `/dashboard/operations/recovery`. The endpoint returns workflow name, failure code, attempt count and recovery history, but never exposes the original job payload or credentials.
- Recovery creates a **new** workflow run and queue job from the original immutable snapshot. It does not reset or mutate the original failed job.
- The recovery RPC accepts only an original job whose status is `dead_letter` and whose execution mode is `dry_run`. The new job is always `dry_run`.
- Every recovery request is recorded in `execution_dead_letter_recoveries`; retries of the same Idempotency-Key return the same new job/run.
- A live job is never automatically replayed because a provider may have accepted a request before the worker lost its lease. Reconcile the outcome with the provider first, then create a separate new live execution only through the normal activation and approval flow.
- The migration and PostgreSQL integration test verify that browser roles cannot read the recovery audit table or execute the privileged recovery RPC.
