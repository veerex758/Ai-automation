# Native integration execution

Aivanta has 118 native registry definitions, including 20 internal utility nodes. The provider catalogue contains 100 entries; 98 currently map to registered native implementations and two are marked Coming Soon. Registration means a server-side handler and schemas exist. It does not mean every provider has passed authenticated staging or production verification.

## Execution model

- The native registry is the source of truth for operation schemas and handlers.
- The durable worker validates each workflow step, resolves workspace-scoped credentials, executes the registered operation, validates its output, and persists lease-bound checkpoints.
- Dry-run validates inputs and simulates provider actions without invoking provider handlers.
- Live execution is disabled unless `AIVANTA_LIVE_EXECUTION_ENABLED=true`.
- Each external provider also requires its exact lowercase provider ID in `AIVANTA_LIVE_INTEGRATIONS`. Unknown provider/operation combinations fail closed.
- The durable worker uses the shared SSRF-safe HTTP transport for node HTTP requests. It blocks loopback/private/reserved addresses, rejects mixed public/private DNS answers, pins DNS to a validated public address, does not follow redirects, rejects sensitive transport headers, and bounds request/response size and timeout.
- The standalone registry-run endpoint intentionally has a narrower live allowlist: manual trigger, safe deterministic utility actions, and the separately guarded Resend email path. Provider integrations outside that route must run through the durable worker.

## Additional live-action controls

Provider opt-in is necessary but not sufficient for high-impact destinations:

| Action | Additional server-side control |
| --- | --- |
| Email | `AIVANTA_LIVE_EMAIL_RECIPIENTS`; literal recipients only |
| SMS | `AIVANTA_LIVE_SMS_RECIPIENTS`; literal E.164 recipients only |
| Voice calls | `AIVANTA_LIVE_VOICE_RECIPIENTS`; literal E.164 recipients only |
| Public social publishing (X, Facebook Pages, Instagram) | `AIVANTA_LIVE_PUBLISHING_ENABLED=true` |
| JavaScript execution | `AIVANTA_JAVASCRIPT_SANDBOX_ENABLED=true`; isolated Vercel Sandbox with network deny-all |

No provider or high-impact action is enabled by this code change. Environment flags and recipient lists must be reviewed and configured separately. Payment-related adapters in this catalogue create customer/checkout records as described by their operation contracts; they must not be represented as payment capture unless a dedicated capture operation is implemented and separately approved.

## Credentials

- Credentials are resolved from the current workspace only.
- Google products use the server-only `google_connections` store; the worker checks the required scope, refreshes expired access tokens server-side, and re-encrypts the refreshed token envelope.
- Other providers use the existing AES-256-GCM workspace credential envelope with workspace/provider associated-data binding.
- Missing, mismatched, unsupported, or undecryptable credentials fail before the provider operation runs.
- Secrets are not returned in node outputs. Provider errors should remain stable, sanitized codes; authorization headers and raw provider response bodies must not be logged.

## Durability and retry boundaries

- Durable jobs use leases, heartbeats, checkpoints, and resumable loop iteration IDs.
- Wait nodes pause the queue job and resume from a durable checkpoint; they do not sleep inside a server process.
- Error Trigger delivery is persisted through the database outbox/dispatch RPC path.
- A checkpoint failure after an external provider accepts a request can create an uncertain outcome. Do not claim exactly-once execution for providers that do not support idempotency keys. Provider-specific idempotency and reconciliation are required before broad production enablement.
- Deterministic utility actions are safe to execute live. The shared Rate Limiter requires the database-backed atomic RPC and fails closed when unavailable.

## Verification status

- Registry validation checks unique node/operation IDs, schemas, handler presence, metadata, and JSON Schema exportability.
- Provider contract tests use mocked HTTP responses. They cover request construction, response parsing, missing credentials, and selected provider error paths.
- Mocked tests do not prove real OAuth consent, token refresh/revocation, provider permissions, production-account behavior, or authenticated staging end-to-end execution.
- Do not mark a provider production-ready until its credential setup, least-privilege scopes, read/write boundaries, error/rate-limit behavior, idempotency/retry behavior, and authenticated staging test are verified.
