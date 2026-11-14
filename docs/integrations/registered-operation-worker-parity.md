# Registered operation vs durable worker parity audit

**Source of truth:** `nodes/registry.ts`, `nodes/provider-catalog.ts`, `lib/workflows/worker-operation-map.ts`, and `tests/worker-operation-parity.test.ts`.

## Current result

- Native executable registry: **122 nodes**.
- Provider directory: **100 entries; all 100 currently map to registered native implementations**.
- Every registered trigger and action must have exactly one worker operation mapping. The parity test checks operation identifier uniqueness and requires `WORKER_OPERATION_MAP.size` to equal the complete registered operation count.
- MySQL and MongoDB are registered native database adapters in `nodes/sql-document-databases.ts`; they are no longer catalogue-only gaps.
- Internal utility definitions have explicit deterministic execution paths. Provider adapters resolve through the worker operation map and workspace credential loader.
- This is source-level and automated-test parity, not authenticated production-provider acceptance.

## Routing and safety

| Operation family | Worker handling | Live-execution boundary |
|---|---|---|
| OpenAI, Gemini, Slack, Email/Resend | Explicit node + operation mapping | Provider allowlist; workspace credentials; operation approval; email recipient allowlist |
| Gmail and Google products | Managed Google product connection and scope checks | Workspace Google connection; required scopes; operation approval |
| HubSpot, Twilio, Shopify, Stripe, Linear and other provider packs | Registered operation mapping | Workspace connection, provider live allowlist and operation approval |
| MySQL and MongoDB | Native database-driver adapters | Workspace connection-string credentials; TLS and network restrictions; integration tests use authenticated TLS containers |
| HTTP Request | Shared SSRF-safe HTTP transport | Public-host validation, safe ports, bounded body/response and timeouts |
| IF, Switch, Merge, Set Fields, JSON Parse, Filter, Aggregate, Date/Time, Loop, Wait and utility pack | Deterministic internal operations | No external provider credentials; execution limits still apply |
| Manual, Schedule, Error Trigger | Trigger-specific durable handling | Server-side dispatch and queue ownership |
| Verified Webhooks | Signed ingress, receipt idempotency and durable live queue | `AIVANTA_DURABLE_WEBHOOK_LIVE_ENABLED`, global live kill switch, workspace credentials and operation approvals |

## Acceptance distinctions

1. **Registered does not mean live-enabled.** The exact provider must be permitted by the server-side live integration allowlist.
2. **Worker mapping does not mean credentials are ready.** Activation checks workspace connections; the worker decrypts credentials server-side.
3. **Operation approval is separate from connection status.** Each external operation is checked immediately before its handler.
4. **Database-container tests do not replace authenticated staging.** MySQL and MongoDB still need real workspace connection acceptance.
5. **Webhook ingress is not a shortcut around live policy.** It verifies the raw request signature, deduplicates event IDs, queues an immutable workflow version, and delegates execution to the same durable worker.

## Verification boundary

The current CI must pass provider catalogue tests, worker-operation parity, authenticated MySQL/MongoDB service integration, and clean migration replay. Real OAuth consent, real provider credentials and authenticated staging end-to-end runs remain separate acceptance requirements. No provider is labelled production-live-verified solely from this audit.
