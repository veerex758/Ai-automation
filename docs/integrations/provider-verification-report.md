# Aivanta provider execution verification

## Current source-of-truth counts

- Native executable registry: **122**
- Provider directory: **100**
- Provider entries with registered implementations: **100**
- Coming-soon provider entries: **0**
- Worker-operation parity: enforced by `tests/worker-operation-parity.test.ts`; every registered trigger/action must have exactly one mapping
- MySQL and MongoDB: real native adapters; authenticated TLS database-container integration is covered by the Database service integration workflow

The earlier report's 120-node / 148-operation count and CI run identifiers were tied to an older source revision. The 122-node and 100/100 provider counts are asserted by the current `tests/provider-catalog.test.ts`. Do not reuse old run numbers as current release evidence.

## Verification boundary

| Verification level | Current evidence | What it proves |
|---|---|---|
| Registry presence | Provider catalogue and native registry tests | Provider definitions and schemas are registered |
| Worker mapping | Worker-operation parity test | Every registered operation resolves to a worker mapping |
| Database-driver integration | Real MySQL and MongoDB authenticated TLS service workflow | The native database adapters work against test database containers |
| CI / migration replay | Current PR #207 workflows | Must be green on the final head commit before merge |
| OAuth consent and refresh | Not comprehensively accepted for all providers | Still requires real workspace accounts and provider scopes |
| Authenticated staging workflow acceptance | Not yet completed | Requires a staging account, configured secrets and end-to-end user testing |
| Production provider acceptance | Not yet completed | No provider should be labelled production-live-verified from source tests alone |

## Provider safety rules

- Live execution is fail-closed by `AIVANTA_LIVE_EXECUTION_ENABLED` and the provider allowlist `AIVANTA_LIVE_INTEGRATIONS`.
- Workspace provider connections must be present and tested before activation.
- External provider operations require an explicit workspace operation approval.
- Email, SMS and voice destinations have additional server-side recipient allowlists.
- Social publishing has a separate global enablement gate.
- Signed webhook execution uses the durable queue and is separately gated by `AIVANTA_DURABLE_WEBHOOK_LIVE_ENABLED`; it requires signature verification, idempotency, workspace credentials and operation approvals.
- Live execution uses one attempt where the provider outcome could be uncertain; the worker must not blindly replay a side effect after lease loss.

## Release gate

Keep production activation and external provider claims blocked until the final PR head has green CI, database-service integration and clean migration replay, followed by authenticated staging acceptance with real workspace connections. No production migration, environment-variable change or deployment is authorized by this report.
