# Phase 11 — Safe logging and route integration

This change ports the reviewed structured logging helper onto current `main` and integrates it with the health, AI workflow generation, and scheduler routes while preserving existing authentication and workflow execution behavior.

The helper emits only allow-listed operational fields and validates request IDs, route names, outcomes, stable error codes, and non-negative integer counters. Unknown fields—including prompts, emails, tokens, authorization headers, provider payloads, and workflow identifiers—must not be logged.

The health, AI generation, and scheduler responses return a validated `x-request-id` and use `Cache-Control: no-store`. AI generation logs bounded success/failure outcomes without prompts or provider responses. Scheduler claim/finalization transport failures are contained and remain recoverable through lease expiry; scheduled workflow processing remains dry-run only, with no provider side effects enabled.

Focused tests cover sensitive-field exclusion, stable error-code allowlisting, response request IDs/cache headers, and scheduler transport-failure containment. The proposed database index migration is deliberately excluded and requires separate schema review. No remote database changes, deployment, live workflow execution, or production action is part of this PR.