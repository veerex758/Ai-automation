# Rexnora AI Gateway — Phase 5 Credit Accounting

## Non-negotiable billing invariants

A provider switch is an implementation detail of one logical AI operation. It is not a new customer operation and never creates a second customer billing event.

For workflow generation:

1. The client creates a UUID and sends it as `Idempotency-Key`. The server validates it and uses it as the logical `operation_id`. It returns the same value in `x-operation-id`.
2. The server fingerprints the normalized prompt, starter type and selected CRM. Reusing an operation ID with different input is rejected.
3. The server reserves one generation slot and one AI-credit slot through `reserve_ai_generation_usage`. A reservation is a hold in a private table, not a row in `workspace_usage` and not a consumed credit.
4. Gemini, Groq and any future eligible provider attempts, including the controlled schema-repair pass, share the same operation ID and provider-attempt budget.
5. Rexnora validates the complete registered workflow graph and execution plan.
6. Only after validation does `consume_ai_generation_usage` atomically write one `ai_generation` row, one `ai_credit` row, the provider-usage records, and the reservation's `consumed` state.
7. Every pre-settlement failure and invalid output releases the hold through `release_ai_generation_usage`. A hold is also expired after ten minutes if a process disappears before its finally block can release it.

## Idempotency and concurrency

The reservation key is `(workspace_id, operation_id)`. The SHA-256 request fingerprint prevents the same operation ID from being reused with changed prompt/starter/CRM input.

Reservation, settlement, release, generic AI-credit metering and agent-run metering serialize through the same workspace advisory transaction lock. Quota checks count existing consumed usage plus active holds. The hold therefore cannot be spent by a parallel generation, generic AI-credit event, or agent run.

- Repeated reserve while an operation is active returns `operation_in_progress`; no second provider run is started.
- Repeated reserve after consumption returns `already_consumed`; no second customer charge is made.
- A released operation can retry with the same ID and the same fingerprint.
- A released or consumed operation cannot be changed to another input by reusing the ID.
- Repeated release is a no-op.
- Release after consume is a no-op; it never deletes or refunds a committed usage row.
- Repeated settlement returns the consumed operation state and cannot insert another customer usage row.

## Provider usage versus customer billing

`private.ai_provider_usage_events` is a separate provider-cost ledger keyed by workspace, logical operation, provider and model. It stores input/output/total tokens, optional provider-reported USD cost and whether that provider was used as fallback.

For a successful validated generation, provider telemetry and the single customer charge are committed in the same database transaction.

For an invalid or failed generation, any token usage returned by a provider is written by the release transaction, while customer `ai_credit` and `ai_generation` usage remains unchanged. If a later retry with the same operation ID succeeds, provider usage from the earlier attempt and the successful attempt is aggregated under that same provider/model record.

Provider token/cost accounting is not subtracted from the user's credit balance and never triggers a second customer charge.

## Settlement response uncertainty

A database transaction may commit even if its HTTP response is lost. When the settlement RPC reports an error, the route checks the reservation through the idempotent release RPC:

- `already_consumed`: the transaction committed; the route returns the validated result without another charge.
- `released` / `already_released`: the hold is confirmed released and no customer charge occurred.
- If the database cannot confirm either state, the route returns `AI_USAGE_SETTLEMENT_UNKNOWN`. The UI's retry action reuses the exact same `Idempotency-Key`. It must not create a new logical operation automatically.

## Security boundaries

Reservation, settlement and release execute through authenticated workspace-scoped RPCs. The reservation and provider-usage tables are in the private schema, have RLS enabled, and have no direct browser/service-role table grants. Provider usage is written only through the private database helper from the security-definer RPCs. Provider credentials, prompts and raw responses are not recorded in this ledger or operational logs.

## Verification

Phase 5 adds API and UI contract tests plus pgTAP coverage for:

- one reservation and no charge before validation;
- same-key concurrent duplicate and changed-input rejection;
- retry after release using the same operation ID;
- Gemini-to-Groq fallback with exactly one customer credit and one generation row;
- idempotent settlement and release-after-consume behavior;
- invalid output releasing the credit while preserving provider token usage;
- generic AI-credit and agent-run metering respecting outstanding holds;
- browser-role access restrictions on the private reservation and provider-usage tables.
