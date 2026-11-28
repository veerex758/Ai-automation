# Customer Pilot Capability Gates

## Purpose

Do not count catalogue entries as usable integrations. A capability is customer-ready only when its runtime operation, validation, authentication, execution path, observability, and recovery behavior are present.

## Verified implementation boundaries (current main + reconciliation)

| Capability | Runtime | Execution boundary | Pilot status |
|---|---|---|---|
| Manual trigger | Registered | Live dispatch through the durable queue; every provider node requires a selected workspace connection | Guarded |
| Email / Resend | Implemented | Selected workspace connection, provider test, explicit live allowlist and recipient policy | Narrow guarded pilot |
| Slack | Registered | Selected workspace connection; provider approval and live operation allowlist still required | Dry-run unless separately enabled |
| Gemini text | Registered workspace credential node | Explicit Gemini connection ID, server-side encrypted credential resolution, provider test and operation approval | Guarded pilot path |
| WhatsApp Business approved template | Registered `send_template` operation, E.164 validation and encrypted template defaults | Explicit provider opt-in + operation approval; customer-channel consent and durable send ledger must be enforced by the calling workflow | Catalogue capability only; not wired into native real-estate pipeline |
| Google Calendar event create | Registered `create_event`, owned-calendar OAuth scope, harmless connection probe and notifications off by default | Explicit provider opt-in + operation approval; booking slot must be checked and confirmed before event creation | Catalogue capability only; native inspection booking and appointment ledger not complete |
| Inbound webhook | Signed ingress, replay protection and durable queue | Endpoint/workspace binding, verified ingress marker, per-node account selection and one-attempt live processing | Narrow pilot path; not general availability |
| HTTP Request | Registered, SSRF-safe transport | Workspace credential + runner policy | Test before customer activation |
| Schedule | Scheduler infrastructure exists | Trigger/runtime capability is separately gated | Not a universal schedule node |

## Customer acquisition rule

The builder and AI generator must never imply an operation can run live unless it:
1. Exists in the TypeScript runtime registry with strict input/output schemas.
2. Stores a selected workspace connection ID on the node; secrets are encrypted and resolved only by the server worker.
3. Is allowed by the production execution policy and explicit activation.
4. Has dry-run, error reporting, run history, idempotency, and deactivation coverage.
5. Explains permissions, external side effects, and provider charges before activation.

Use explicit capability states: `live_guarded`, `dry_run_only`, `coming_soon`, and `unsupported`.

## First design-partner outcome

Target: **capture an enquiry, qualify it, and notify a business owner**.

Before calling it a live customer automation, verify an authenticated workspace inbound trigger, customer-approved AI prompt/data policy, individually selected and successfully tested Gemini and Resend accounts, safe test then explicit activation, run history/failure recovery, usage measurement, and a reliable off switch.

Direct synchronous legacy live-run routes are disabled. Live execution must use the registered workflow format and durable dispatch so each provider node's selected connection is checked again at execution time. Until that exact path passes end-to-end staging with real Gemini and Resend accounts, position it as a design-partner preview—not production lead management. Never claim a dry-run sent a notification or processed a real lead.

## Implementation order

1. Keep registry, legacy catalogue, generator, validator, and builder capability states aligned; add parity tests.
2. Generate only registered operations and preserve execution restrictions.
3. Complete one pilot path with workspace connections and explicit activation gates.
4. Record usage only from actual executions; never bill validation or dry-runs as successful live usage.
5. Expand from customer evidence, not catalogue size.

## Success measures

Qualified design partners, pilot starts, successful end-to-end runs, time-to-first-value, weekly active workflows, execution success, recovery time, usage/customer, pilot-to-paid conversion, and retention.
