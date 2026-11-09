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
2. Uses workspace-scoped credentials or an explicitly doc¶»§q«^