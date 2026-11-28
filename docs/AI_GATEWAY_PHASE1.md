# Rexnora AI Gateway — Phase 1

## Scope
Phase 1 introduces the server-side provider contract and routes workflow draft generation plus its single schema-repair request through the Gemini adapter.

## Enabled provider
- Gemini is the only provider registered by default.
- The adapter supports text, JSON-structured output, and normalized tool calls.
- API credentials are read only from server-side environment and are never returned to callers.
- The active workflow-generation API continues to use the staging persistent Gemini circuit-breaker RPC and its safe attempt diagnostics; the new local in-memory circuit store is not wired into production.

## Retry and request budget
- Primary Gemini requests follow the current staging contract: at most three same-model attempts for transient 5xx responses, one bounded 429 retry, then the configured Gemini model fallback only for eligible transient errors.
- 429 never fans out to the fallback model. Network-unavailable errors also do not fan out.
- Workflow generation and the single schema-repair operation share the same logical operation ID, 54-second deadline, and bounded attempt budget.
- Provider attempt diagnostics contain model, status, safe reason/type/request ID and retry metadata only. Prompts, response bodies, and credentials are not logged.

## Not enabled in this phase
- Groq and Cloudflare modules implement the common contract as explicit disabled placeholders. They are not registered or eligible for routing.
- Groq transport, JSON-schema/tool compatibility, rate-limit headers, and task quality gates belong to Phase 2/3.
- Cloudflare Workers AI remains disabled until Phase 4 compatibility and quality benchmarking.
- The local in-memory circuit-breaker store is for unit/local use only. The staging Supabase circuit-breaker remains the production health-state authority.
- When the gateway is injected into the workflow generator, the legacy generator does not read Gemini environment variables or choose a model; provider configuration is exclusively handled by the registry/router.

## Billing and workflow safety boundaries
The gateway reports normalized provider token usage only. It does not consume customer credits. Workflow generation retains the authoritative registered-operation/input validation, graph topology, reachability, rebuild, and execution-step checks. The existing atomic consume_ai_generation_usage RPC remains after graph validation. Provider usage telemetry is recorded separately from customer credits. Generation never saves, activates, or executes a workflow.

## Remaining migration surfaces
Agent tool calling and tenant-owned Gemini connections used by real-estate qualification remain server-side. They are not redirected to the platform Gemini key by this phase; their credential ownership and approvals need separate migration work.
