# Phase 11 — Safe logging primitive

This change ports the reviewed structured logging helper onto current `main` without carrying the stale API-route or scheduler edits from the diverged Phase 11 branch.

The helper emits only a small allowlist of operational fields and validates request IDs, route names, outcomes, stable error codes, and non-negative integer counters. Unknown fields—including prompts, emails, tokens, and authorization headers—are dropped.

This PR deliberately does **not** wire the helper into routes or change scheduler behavior. That integration must be ported separately against current `main`, with current route semantics preserved and exact-head CI evidence. No external workflow execution or database changes are part of this patch.
