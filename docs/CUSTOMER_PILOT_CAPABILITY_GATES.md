# Customer Pilot Capability Gates

## Purpose

Prioritise Aivanta work that helps acquire, onboard, retain, and convert real customers. Do not count catalogue entries as usable integrations. A capability is customer-ready only when its runtime operation, validation, authentication, execution path, observability, and recovery behavior are all present.

## Current verified implementation snapshot

Based on the current `main` source:

| Capability | Runtime operation exists | Advertised in legacy action catalogue | Live workflow endpoint | Pilot status |
|---|---:|---:|---:|---|
| Manual trigger | Yes | Trigger registry | Supported as the only live trigger | Available within guarded live flow |
| Email / Resend | Yes | Yes | Live, behind server flag and recipient allowlist | Narrow guarded live capability |
| Slack incoming webhook | Yes | Yes, marked dry-run-only | Live endpoint rejects it | Dry-run only |
| OpenAI text generation | Yes | No | Live endpoint rejects it; dry-run can validate registered steps | Not customer-live |
| Inbound webhook trigger | Yes | Trigger metadata | Live endpoint rejects it | Not customer-live |
| Schedule trigger | No matching runtime node module in `nodes/registry.ts` | Trigger metadata says existing scheduler | Not accepted as a live trigger | Do not promise as a general node |
| Internal create task | No matching runtime node operation | Yes, dry-run-only | No runtime operation mapping | Catalogue-only; do not present as executable |
| Outbound HTTP request | No matching runtime node operation | Yes, dry-run-only | No runtime operation mapping | Catalogue-only; do not present as executable |

This table is intentionally conservative. A code module existing is not enough to claim customer-ready live support: the workflow execution endpoint currently applies a separate live allowlist.

## Acquisition rule

The customer-facing builder and AI generator must never imply that an operation can run live unless the same operation passes all of these gates:

1. It is implemented in the TypeScript runtime node registry.
2. Its input and output schemas validate real provider requests and responses.
3. Its authentication model is configured and scoped to the customer's workspace (or is explicitly documented as a server-managed pilot connection).
4. The production execution route permits it under an explicit safety policy.
5. Dry-run, error reporting, run history, idempotency, and deactivation behavior are covered.
6. The customer can understand required permissions, external side effects, and any provider charges before activation.

Use explicit capability states: `live_guarded`, `dry_run_only`, `coming_soon`, and `unsupported`. Do not use a generic “available” state where it hides execution restrictions.

## First customer-acquisition milestone

Do not attempt to enable 100+ integrations before speaking to customers. Validate one repeatable outcome with design partners first.

Initial target outcome: **capture a new enquiry, qualify it, and notify the business owner**.

Before selling this as a live automation, the product must support and pass an end-to-end test for:
- an authenticated, workspace-scoped inbound lead trigger;
- AI qualification using a customer-approved prompt and data policy;
- a customer-configured notification action;
- a safe test run followed by explicit customer activation;
- run history, failure visibility, usage measurement, and a reliable off switch.

Until those gates pass, position the experience as a design-partner preview / workflow prototype, not a live lead-management automation. Never process real customer leads under a dry-run claim that implies external actions occurred.

## Implementation order

1. Reconcile the TypeScript runtime registry, legacy action catalogue, AI generator, validator, and public builder response. Add automated parity tests so an operation cannot be advertised as executable without a runtime implementation.
2. Make AI generation produce only registered operations and preserve their true execution state.
3. Add the smallest complete live pilot path for the first validated customer outcome, including workspace-scoped connections and explicit activation safeguards.
4. Add server-side usage records tied to actual executions and provider usage. Do not bill failed validation or simulated dry-runs as successful live executions.
5. Expand integrations based on repeated customer demand, not catalogue size.

## Success measures

Track qualified design partners, pilot starts, successful end-to-end workflows, time-to-first-value, weekly active workflows, execution success rate, failure recovery time, usage per customer, pilot-to-paid conversion, and customer retention. These are more meaningful acquisition and product-value signals than the number of listed integrations.
