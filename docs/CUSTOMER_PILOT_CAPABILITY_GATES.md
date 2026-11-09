# Customer Pilot Capability Gates

## Purpose

Do not count catalogue entries as usable integrations. A capability is customer-ready only when its runtime operation, validation, authentication, execution path, observability, and recovery behavior are present.

## Verified implementation boundaries (current main + reconciliation)

| Capability | Runtime | Execution boundary | Pilot status |
|---|---|---|---|
| Manual trigger | Registered | Live route has explicit policy | Guarded |
| Email / Resend | Implemented | Server flag + recipient allowlist | Narrow guarded live |
| Slack | Registered | Not enabled in live allowlist | Dry-run / registry execution only |
| Gemini text | Registered workspace credential node | Provider call occurs only in registered runner; no general live activation claim | Connected test / draft |
| Inbound webhook | Signature verification and ingress plumbing | Workflow dispatch still requires its own persisted, guarded path | Do not market as generally live |
| HTTP Request | Registered, SSRF-safe transport | Workspace credential + runner policy | Test before customer activation |
| Schedule | Scheduler infrastructure exists | Trigger/runtime capability is separately gated | Not a universal schedule node |

## Customer acquisition rule

The builder and AI generator must never imply an operation can run live unless it:
1. Exists in the TypeScript runtime registry with strict input/output schemas.
2. Uses workspace-scoped credentials or an explicitly documented server-managed pilot credential.
3. Is allowed by the production execution policy and explicit activation.
4. Has dry-run, error reporting, run history, idempotency, and deactivation coverage.
5. Explains permissions, external side effects, and provider charges before activation.

Use explicit capability states: `live_guarded`, `dry_run_only`, `coming_soon`, and `unsupported`.

## First design-partner outcome

Target: **capture an enquiry, qualify it, and notify a business owner**.

Before calling it a live customer automation, verify an authenticated workspace inbound trigger, customer-approved AI prompt/data policy, configured notification action, safe test then explicit activation, run history/failure recovery, usage measurement, and a reliable off switch.

Until that exact path passes end-to-end staging, position it as a design-partner preview—not production lead management. Never claim a dry-run sent a notification or processed a real lead.

## Implementation order

1. Keep registry, legacy catalogue, generator, validator, and builder capability states aligned; add parity tests.
2. Generate only registered operations and preserve execution restrictions.
3. Complete one pilot path with workspace connections and explicit activation gates.
4. Record usage only from actual executions; never bill validation or dry-runs as successful live usage.
5. Expand from customer evidence, not catalogue size.

## Success measures

Qualified design partners, pilot starts, successful end-to-end runs, time-to-first-value, weekly active workflows, execution success, recovery time, usage/customer, pilot-to-paid conversion, and retention.
