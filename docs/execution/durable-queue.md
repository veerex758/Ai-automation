# Durable execution queue (foundation)

This migration introduces a server-owned PostgreSQL queue for Aivanta workflow executions.

## Guarantees in this phase
- **Persistent dispatch:** one server-side transaction serializes each workspace/idempotency key, creates the run and job together, snapshots the exact workflow version/definition, and returns the existing job for duplicate delivery.
- **Worker claims:** claims use row locks with `SKIP LOCKED`, per-attempt lease tokens, and bounded leases. Expired running leases can be reclaimed.
<<<<<<< HEAD
- **Checkpoints:** one durable checkpoint per job/step records status and bounded output metadata. Webhook trigger output is redacted to event metadata and a payload hash; the original signed payload remains only in the private execution job for retry rehydration.
- **Retries:** transient dry-run failures are rescheduled with capped exponential backoff. Live jobs use one attempt and are never automatically replayed after an uncertain provider result.
=======
- **Checkpoints:** one durable checkpoint per job/step records status and bounded input/output metadata. This phase records progress but does not yet resume the dry-run executor from a checkpoint; retries re-evaluate the side-effect-free workflow.
- **Retries:** only classified transient failures are rescheduled with capped exponential backoff. Permanent validation, authorization, configuration and provider-rejection errors go directly to dead letter.
>>>>>>> origin/pr207
- **Dead letters:** jobs reaching their attempt limit are copied to a separate dead-letter table with a stable error code.
- **Monitoring data:** job status, attempt count, availability, lease, worker ID, and safe error code are queryable by trusted server-side operators.

## Worker endpoint
Deploy the Next.js application with a server-only `CRON_SECRET` (or `AIVANTA_WORKER_SECRET`) and Supabase service key. Invoke `POST /api/internal/worker` with `Authorization: Bearer <secret>`. The worker claims one job per pass and drains up to 25 jobs within a 50-second budget. After a transient retry it waits 10 seconds (covering the database's 5-second and 10-second backoffs) before claiming again; it never polls indefinitely.

<<<<<<< HEAD
The worker executes legacy workflows and registry workflows in dry-run mode. Registry-format jobs may execute approved live operations only when the authenticated dispatch request explicitly sets mode=live, the workflow is active, AIVANTA_LIVE_EXECUTION_ENABLED=true, and every external node has a selected, connected, freshly tested workspace connection. Live jobs are limited to one attempt: if the worker loses its lease or a provider outcome becomes uncertain, the job is not automatically replayed. Legacy synchronous live-run and direct registry live-run endpoints reject live execution; all live provider operations must pass through /dispatch and the durable worker.
=======
The worker executes legacy workflows and registry workflows in dry-run mode. Registry-format jobs may execute live registered actions only when the dispatch request explicitly sets mode=live and AIVANTA_LIVE_EXECUTION_ENABLED=true. Live retries are operation-allowlisted. A workflow containing Resend email plus only approved deterministic transforms and Gemini qualification/generation may receive up to three attempts. Resend receives a stable per-job/per-step Idempotency-Key, so a retry after an uncertain email response does not send the same email twice. Gemini can be called again if a crash happens before its checkpoint is persisted, which may incur another model usage charge. Other provider write operations remain single-attempt and are dead-lettered when their outcome is uncertain.
>>>>>>> origin/pr207

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
10. Confirm live execution stays disabled by default; enable it only in an isolated staging workspace after provider connections, selected account IDs, provider tests, operation approvals, recipient limits, and rollback controls pass.

## Operational limits
<<<<<<< HEAD

- Authenticated manual dispatch schedules an immediate server-side worker wake-up after the dispatch response. The /api/internal/worker endpoint remains available to an external scheduler for queued scheduled jobs, recovery, and maintenance; this repository does not provision a continuously running process.
- Queue tables and RPCs are service-role only.
- Dispatch creation and successful run finalization are transactional and lease-checked. Live jobs have one attempt because provider acceptance can be uncertain; they are not automatically replayed after a worker/lease failure.
- Dead-letter replay UI and operator controls are a follow-up.
- Live provider operations also require the workspace provider-operation approval and the per-provider entry in AIVANTA_LIVE_INTEGRATIONS. Global live execution alone never makes every catalog operation executable.
- Credential encryption requires AIVANTA_CREDENTIALS_ENCRYPTION_KEY to be a base64-encoded 32-byte AES-256-GCM key. Never place this key or provider secrets in client-side environment variables.
=======
- Authenticated manual dispatch schedules an immediate server-side worker wake-up after the dispatch response. A private Vercel Schedule function sweeps abandoned leases every 30 minutes. It is environment-gated by `AIVANTA_DURABLE_WORKER_SCHEDULE_ENABLED=true`; the `schedule/v1beta` trigger keeps the function private, so it does not need a public route or `CRON_SECRET`. Keep the flag off in Preview until that environment has passed acceptance. The 30-minute schedule uses 1,440 runs per 30-day month per environment, keeping Production and Preview together below the 5,000 monthly Hobby Schedules allowance.
- Queue tables and RPCs are service-role only.
- Dispatch creation and successful run finalization are transactional and lease-checked. A pending cancellation wins over an expired lease: the claim RPC finalizes the job as cancelled instead of issuing a new lease. Only provider actions with a verified idempotency contract are eligible for automatic live retry; unknown operations fail closed. Other uncertain live outcomes require provider reconciliation before a new execution.
- Dead-letter operator recovery remains dry-run-only; live dead letters cannot be replayed automatically.
>>>>>>> origin/pr207

## Workspace connections and per-node account selection

- Every node that requires authentication stores only a connection UUID in its workflow step. The browser and saved workflow definition never receive access tokens, API keys, refresh tokens, or database passwords.
- The builder filters the connection picker by the selected node's provider or Google product. Every authenticated node requires an explicit connection ID, even when only one account exists. Adding, removing, or reconnecting another account can never silently change the account a workflow uses.
- Generic provider secrets are encrypted in workspace_integration_secrets and are decrypted only inside the server worker immediately before the node runs. The worker verifies connection ID, provider, workspace ID, connected status, and passed test status again at execution time.
- Google products use their dedicated Google OAuth connection store. The OAuth flow requests product-specific read-only scopes for Gmail, Sheets, Drive, Calendar, Docs, Forms, YouTube, and Contacts; it prompts for account selection and stores tokens encrypted server-side. Google connection verification checks the verified account identity and required granted scope without changing provider data. A workspace node can reuse the same Google connection only for the matching product and workspace.
- Generic OAuth provider connections are stored as separate workspace accounts. The credential manager supports add another account, test, reconnect/rotate, and disconnect. Rotating a credential invalidates its previous test; disconnected account IDs fail closed in live execution.
- Connection test means a provider-specific, non-destructive verification request where one is supported. Some providers do not expose a safe read-only check; those are explicitly shown as unverified and cannot be considered production-verified solely because credentials were saved. In particular, a Resend setup test may send a one-off test email only after an explicit click and only to the configured fixed test recipient. A failed or uncertain check does not mark the account ready.
- Owner/admin authorization is required for connection creation, testing, rotation, and disconnect. API and worker lookups are scoped to the active workspace; a connection ID from another workspace is never accepted as a substitute.
- Multiple accounts are independent rows per workspace/provider, and each node can choose a different account for the same provider. Shared use means reusing the workspace-owned connection ID, not copying credential material between nodes.

## Provider execution and webhook ingress

<<<<<<< HEAD
- Manual live dispatch goes through POST /api/workflows/{workflowId}/dispatch with a UUID Idempotency-Key and mode=live. The worker resolves each selected connection just before the associated registered node runs. Live provider operations are additionally gated by the server-side provider allowlist, operation approval, recipient controls, and current workspace membership.
- Direct registry live runs and the legacy synchronous live-run endpoint return DURABLE_DISPATCH_REQUIRED. They must not be used to run external actions because they bypass per-node workspace credential resolution.
- Scheduled workflow ingress remains dry-run only in this phase. It queues work into the durable queue using a schedule-occurrence idempotency key.
- Signed webhook ingress is queue-only. Dry-run queueing requires AIVANTA_DURABLE_WEBHOOK_DRY_RUN_QUEUE_ENABLED=true. Live webhook queueing additionally requires AIVANTA_DURABLE_WEBHOOK_LIVE_ENABLED=true and AIVANTA_LIVE_EXECUTION_ENABLED=true. The ingress verifies the raw-body signature, endpoint/workspace binding, replay timestamp and event id before queueing. Live webhook execution is currently restricted to the approved webhook trigger → Gemini qualification → Resend notification pilot path and uses a single attempt. The worker validates the signed ingress marker and endpoint ID before executing.
- Webhook job payloads are retained only inside the service-owned execution queue for deterministic retry handling. The trigger checkpoint and run history do not persist raw webhook lead data; they retain safe event metadata plus the SHA-256 payload digest.
- Apply supabase/migrations/20261120130000_rexnora_multi_account_connections.sql only after the base workspace integrations and Google migrations are applied. CI migration replay must pass before enabling connection creation in a staging/prod deployment.
=======
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
>>>>>>> origin/pr207

## PostgreSQL failure-injection coverage

The CI workflow provisions an isolated PostgreSQL 16 service named `aivanta_test` and runs `tests/durable-execution-postgres.test.mjs` through `npm test`. The suite applies the queue migration to a minimal fixture schema and exercises concurrent `SKIP LOCKED` claims on separate connections, simultaneous duplicate dispatch, abandoned worker lease recovery, retry exhaustion/dead-letter/run failure, and denial of queue-table/RPC access to `anon` and `authenticated`. The integration harness refuses to run destructive setup unless `AIVANTA_TEST_DB=1` and the database name is exactly `aivanta_test`. It does not connect to staging or production.


## Trigger queue bridge (guarded)

- The internal scheduler dispatches due scheduled workflows into the durable queue using a schedule-occurrence idempotency key, then releases its schedule lease. The queue worker processes the immutable snapshot as a dry-run and owns retries/dead letters.
- Verified webhook ingress is queue-only. Dry-run queueing requires the server-only `AIVANTA_DURABLE_WEBHOOK_DRY_RUN_QUEUE_ENABLED=true` flag. Live webhook queueing additionally requires `AIVANTA_DURABLE_WEBHOOK_LIVE_ENABLED=true` and `AIVANTA_LIVE_EXECUTION_ENABLED=true`, and remains restricted to the approved webhook trigger → Gemini qualification → Resend notification pilot path.
- The ingress verifies raw-body signature, endpoint/workspace binding, replay timestamp and event ID. It enqueues an immutable job snapshot with an idempotency key and signed-source metadata. The durable worker rejects jobs without a verified webhook marker and endpoint UUID. Live webhook jobs use one attempt; uncertain provider outcomes are not replayed automatically.
- Duplicate delivery retries the same idempotent queue RPC; the receipt is updated only after checking the endpoint ID. Raw event data remains only in the private queue payload while trigger checkpoints and run history store safe event metadata and the SHA-256 payload digest.
- Scheduled queue definitions remain dry-run only in this phase. All provider operations—manual or webhook-triggered—must pass through the durable worker and its per-node selected workspace connection checks.
