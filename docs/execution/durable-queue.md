# Durable execution queue (foundation)

This migration introduces a server-owned PostgreSQL queue for Aivanta workflow executions.

## Guarantees in this phase
- **Persistent dispatch:** one server-side transaction serializes each workspace/idempotency key, creates the run and job together, snapshots the exact workflow version/definition, and returns the existing job for duplicate delivery.
- **Worker claims:** claims use row locks with `SKIP LOCKED`, per-attempt lease tokens, and bounded leases. Expired running leases can be reclaimed.
- **Checkpoints:** one durable checkpoint per job/step records status and bounded output metadata. Webhook trigger output is redacted to event metadata and a payload hash; the original signed payload remains only in the private execution job for retry rehydration.
- **Retries:** transient dry-run failures are rescheduled with capped exponential backoff. Live jobs use one attempt and are never automatically replayed after an uncertain provider result.
- **Dead letters:** jobs reaching their attempt limit are copied to a separate dead-letter table with a stable error code.
- **Monitoring data:** job status, attempt count, availability, lease, worker ID, and safe error code are queryable by trusted server-side operators.

## Worker endpoint
Deploy the Next.js application with a server-only `CRON_SECRET` (or `AIVANTA_WORKER_SECRET`) and Supabase service key. Invoke `POST /api/internal/worker` with `Authorization: Bearer <secret>`. The worker claims and processes one job per tick so a slow live workflow cannot strand other jobs with already-consumed attempts.

The worker executes legacy workflows and registry workflows in dry-run mode. Registry-format jobs may execute approved live operations only when the authenticated dispatch request explicitly sets mode=live, the workflow is active, AIVANTA_LIVE_EXECUTION_ENABLED=true, and every external node has a selected, connected, freshly tested workspace connection. Live jobs are limited to one attempt: if the worker loses its lease or a provider outcome becomes uncertain, the job is not automatically replayed. Legacy synchronous live-run and direct registry live-run endpoints reject live execution; all live provider operations must pass through /dispatch and the durable worker.

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

- Authenticated manual dispatch schedules an immediate server-side worker wake-up after the dispatch response. The /api/internal/worker endpoint remains available to an external scheduler for queued scheduled jobs, recovery, and maintenance; this repository does not provision a continuously running process.
- Queue tables and RPCs are service-role only.
- Dispatch creation and successful run finalization are transactional and lease-checked. Live jobs have one attempt because provider acceptance can be uncertain; they are not automatically replayed after a worker/lease failure.
- Dead-letter replay UI and operator controls are a follow-up.
- Live provider operations also require the workspace provider-operation approval and the per-provider entry in AIVANTA_LIVE_INTEGRATIONS. Global live execution alone never makes every catalog operation executable.
- Credential encryption requires AIVANTA_CREDENTIALS_ENCRYPTION_KEY to be a base64-encoded 32-byte AES-256-GCM key. Never place this key or provider secrets in client-side environment variables.

## Workspace connections and per-node account selection

- Every node that requires authentication stores only a connection UUID in its workflow step. The browser and saved workflow definition never receive access tokens, API keys, refresh tokens, or database passwords.
- The builder filters the connection picker by the selected node's provider or Google product. More than one saved account for a provider requires an explicit connection ID; the worker does not silently choose an account when selection is ambiguous.
- Generic provider secrets are encrypted in workspace_integration_secrets and are decrypted only inside the server worker immediately before the node runs. The worker verifies connection ID, provider, workspace ID, connected status, and passed test status again at execution time.
- Google products use their dedicated Google OAuth connection store. The OAuth flow requests product-specific read-only scopes for Gmail, Sheets, Drive, Calendar, Docs, Forms, YouTube, and Contacts; it prompts for account selection and stores tokens encrypted server-side. Google connection verification checks the verified account identity and required granted scope without changing provider data. A workspace node can reuse the same Google connection only for the matching product and workspace.
- Generic OAuth provider connections are stored as separate workspace accounts. The credential manager supports add another account, test, reconnect/rotate, and disconnect. Rotating a credential invalidates its previous test; disconnected account IDs fail closed in live execution.
- Connection test means a provider-specific, non-destructive verification request where one is supported. Some providers do not expose a safe read-only check; those are explicitly shown as unverified and cannot be considered production-verified solely because credentials were saved. In particular, a Resend setup test may send a one-off test email only after an explicit click and only to the configured fixed test recipient. A failed or uncertain check does not mark the account ready.
- Owner/admin authorization is required for connection creation, testing, rotation, and disconnect. API and worker lookups are scoped to the active workspace; a connection ID from another workspace is never accepted as a substitute.
- Multiple accounts are independent rows per workspace/provider, and each node can choose a different account for the same provider. Shared use means reusing the workspace-owned connection ID, not copying credential material between nodes.

## Provider execution and webhook ingress

- Manual live dispatch goes through POST /api/workflows/{workflowId}/dispatch with a UUID Idempotency-Key and mode=live. The worker resolves each selected connection just before the associated registered node runs. Live provider operations are additionally gated by the server-side provider allowlist, operation approval, recipient controls, and current workspace membership.
- Direct registry live runs and the legacy synchronous live-run endpoint return DURABLE_DISPATCH_REQUIRED. They must not be used to run external actions because they bypass per-node workspace credential resolution.
- Scheduled workflow ingress remains dry-run only in this phase. It queues work into the durable queue using a schedule-occurrence idempotency key.
- Signed webhook ingress is queue-only. Dry-run queueing requires AIVANTA_DURABLE_WEBHOOK_DRY_RUN_QUEUE_ENABLED=true. Live webhook queueing additionally requires AIVANTA_DURABLE_WEBHOOK_LIVE_ENABLED=true and AIVANTA_LIVE_EXECUTION_ENABLED=true. The ingress verifies the raw-body signature, endpoint/workspace binding, replay timestamp and event id before queueing. Live webhook execution is currently restricted to the approved webhook trigger → Gemini qualification → Resend notification pilot path and uses a single attempt. The worker validates the signed ingress marker and endpoint ID before executing.
- Webhook job payloads are retained only inside the service-owned execution queue for deterministic retry handling. The trigger checkpoint and run history do not persist raw webhook lead data; they retain safe event metadata plus the SHA-256 payload digest.
- Apply supabase/migrations/20261120130000_rexnora_multi_account_connections.sql only after the base workspace integrations and Google migrations are applied. CI migration replay must pass before enabling connection creation in a staging/prod deployment.

## PostgreSQL failure-injection coverage

The CI workflow provisions an isolated PostgreSQL 16 service named `aivanta_test` and runs `tests/durable-execution-postgres.test.mjs` through `npm test`. The suite applies the queue migration to a minimal fixture schema and exercises concurrent `SKIP LOCKED` claims on separate connections, simultaneous duplicate dispatch, abandoned worker lease recovery, retry exhaustion/dead-letter/run failure, and denial of queue-table/RPC access to `anon` and `authenticated`. The integration harness refuses to run destructive setup unless `AIVANTA_TEST_DB=1` and the database name is exactly `aivanta_test`. It does not connect to staging or production.


## Trigger queue bridge (guarded)

- The internal scheduler dispatches due scheduled workflows into the durable queue using a schedule-occurrence idempotency key, then releases its schedule lease. The queue worker processes the immutable snapshot as a dry-run and owns retries/dead letters.
- Verified webhook ingress is queue-only. Dry-run queueing requires the server-only `AIVANTA_DURABLE_WEBHOOK_DRY_RUN_QUEUE_ENABLED=true` flag. Live webhook queueing additionally requires `AIVANTA_DURABLE_WEBHOOK_LIVE_ENABLED=true` and `AIVANTA_LIVE_EXECUTION_ENABLED=true`, and remains restricted to the approved webhook trigger → Gemini qualification → Resend notification pilot path.
- The ingress verifies raw-body signature, endpoint/workspace binding, replay timestamp and event ID. It enqueues an immutable job snapshot with an idempotency key and signed-source metadata. The durable worker rejects jobs without a verified webhook marker and endpoint UUID. Live webhook jobs use one attempt; uncertain provider outcomes are not replayed automatically.
- Duplicate delivery retries the same idempotent queue RPC; the receipt is updated only after checking the endpoint ID. Raw event data remains only in the private queue payload while trigger checkpoints and run history store safe event metadata and the SHA-256 payload digest.
- Scheduled queue definitions remain dry-run only in this phase. All provider operations—manual or webhook-triggered—must pass through the durable worker and its per-node selected workspace connection checks.
