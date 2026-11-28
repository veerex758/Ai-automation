# Rexnora AI Gateway — Phases 0–3

This document records the implemented gateway scope through Phase 3. It does not claim Phase 4 quality-aware model selection or external production-provider acceptance.

## Phase 0 — Shared gateway foundation

The server-side gateway contract is centralized in `lib/ai/types.ts`, `errors.ts`, `usage.ts`, and `validation/workflow-schema.ts`.

- Requests declare a task and stable logical-operation ID.
- Provider capabilities distinguish text, structured output and tool calling.
- Normalized provider errors and token usage have a provider-independent shape.
- Structured output is validated by Rexnora before it is accepted.
- Retry/deadline budgets can be shared by a logical operation, including a controlled workflow schema-repair request.

## Phase 1 — Provider adapters and capability-aware routing

- Gemini is the default primary provider.
- Groq is a real server-side OpenAI-compatible Chat Completions adapter. It is eligible only when `GROQ_API_KEY` is configured.
- Cloudflare Workers AI is deliberately unavailable and is not registered as an eligible adapter. Its circuit-row placeholder does not mean the provider is usable.
- `AI_PRIMARY_PROVIDER` selects Gemini or Groq as the primary. `AI_FAILOVER_ORDER` controls the ordered alternates. The default order reverses when Groq is selected as primary.
- The router filters providers that are unconfigured, excluded by health state, or lack the capability required by the requested task.
- Default Gemini models are `gemini-3.8-flash` and `gemini-3.5-flash-lite`. Default Groq models are `openai/gpt-oss-120b` and `openai/gpt-oss-20b`; model IDs can be overridden server-side.
- Groq structured output uses JSON-object mode followed by Rexnora validation. The adapter does not claim provider-enforced JSON Schema conformance.
- Tool calls are parsed and returned to the caller. The adapter never executes returned tools itself.

## Phase 2 — Bounded automatic retries and provider failover

- **429:** honour `Retry-After`, allow at most one bounded same-provider retry, then fail over when another provider is eligible.
- **500/502/503/504/408:** bounded exponential backoff with full jitter; at most three primary-model calls before a single eligible alternate-model attempt and cross-provider failover.
- **Timeout:** retry only while the shared operation deadline allows it.
- **Network/DNS/socket failure:** do not retry the unreachable host; try the next eligible provider.
- **401/403:** record the provider configuration as unhealthy through the shared circuit and try another eligible provider.
- **400/404/413/422 and invalid request configuration:** stop instead of replaying the same invalid request against another provider.
- **Safety refusals:** preserve refusal metadata/text; never bypass a refusal through provider switching.
- **Malformed structured output:** do not repeat the same malformed request against the same provider. Use an eligible alternate; the workflow route retains one separately bounded registered-node input repair pass.
- **Cancellation, deadline exhaustion and attempt-budget exhaustion:** terminal.
- **Hard ceilings:** three calls to one provider's primary model, at most one same-provider alternate-model call, four calls per provider across all gateway invocations in the logical operation, and eight provider calls total. The workflow route shares its 54-second deadline and attempt budget across generation and repair. Standalone gateway requests default to 30 seconds.

## Phase 3 — Shared provider health, safe recovery and UI integration

- Production uses Supabase-backed shared provider health state rather than per-Vercel-instance memory. In-memory circuit state is used for isolated tests only.
- Gemini, Groq and Cloudflare circuit rows are distinct. Only Gemini and Groq are currently registered as usable adapters; Cloudflare remains disabled.
- The shared service-role RPC controls admission, failure recording, cooldown, a row-locked half-open probe lease, and recovery after a successful probe.
- Circuit storage failure is fail-closed: a request is not sent using an uncoordinated local health decision.
- Thresholds and cooldowns are controlled server-side with `AI_CIRCUIT_FAILURE_THRESHOLD`, `AI_CIRCUIT_FAILURE_RATE_THRESHOLD`, `AI_CIRCUIT_MINIMUM_REQUESTS`, `AI_CIRCUIT_WINDOW_SECONDS`, `AI_CIRCUIT_BASE_COOLDOWN_MS`, `AI_CIRCUIT_MAX_COOLDOWN_MS`, and `AI_CIRCUIT_AUTH_COOLDOWN_MS`.
- The workflow canvas and Playbook starter expose explicit, user-triggered retry for recognized transient provider errors. They preserve the original prompt and CRM choice and display `Retry-After` guidance when the server provides it. They do not create automatic retry loops.
- Provider keys and routing configuration stay server-side. The frontend does not expose provider secrets or permit arbitrary provider selection.
- Operational logs allowlist provider IDs, provider-specific model IDs, request/status metadata and token totals. Prompts, responses, credentials and arbitrary provider payloads are excluded.

## Billing and workflow safety

The gateway reports provider token usage; it does not debit customer AI credits. The workflow generation endpoint checks entitlements before calling a provider and keeps the atomic `consume_ai_generation_usage` RPC after a complete registered graph has passed validation. Provider errors and invalid graphs return before that charge site.

Generation remains draft-only. It does not save, activate or execute a workflow. A user must review and save the generated result separately.

Real-estate tenant-owned Gemini credentials and the separate agent tool loop remain server-side and are not redirected to the platform Gemini key. Those flows have their own credential ownership and approvals.

## Server configuration

Required for the default Gemini-only path:
- `GEMINI_API_KEY`

Optional to enable Groq failover:
- `GROQ_API_KEY`

Optional routing/model controls:
- `AI_PRIMARY_PROVIDER` (`gemini` or `groq`)
- `AI_FAILOVER_ORDER` (comma-separated provider IDs)
- `GEMINI_AI_MODEL`, `GEMINI_FALLBACK_MODEL`
- `GROQ_AI_MODEL`, `GROQ_FALLBACK_MODEL`

Optional circuit controls are listed in Phase 3. All provider keys and AI gateway configuration must be server-side environment variables. Do not put provider keys in `NEXT_PUBLIC_*` variables.

## Verification boundaries

The PR includes unit/contract tests for adapters, routing, attempt limits, refusal handling, structured output, credit-accounting boundaries, shared circuit behavior, safe logs and the explicit Playbook retry control.

A CI migration replay is not the same as an authenticated Supabase Preview branch. A skipped Supabase Preview check must remain recorded as skipped until an equivalent staging database verification is supplied. No real external Gemini-to-Groq failover, customer acceptance, or feature-branch Vercel deployment is claimed by these tests.

Phase 4 — quality-aware model selection and task-specific benchmarking — remains separate work.
