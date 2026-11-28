# Rexnora AI Gateway — Provider Failover

## Provider routing
- Gemini remains the primary provider by default.
- Groq is the first alternate provider and becomes eligible only when `GROQ_API_KEY` is configured on the server.
- Cloudflare Workers AI remains disabled until its adapter and task-specific capability gates pass.
- `AI_PRIMARY_PROVIDER` selects the preferred provider. `AI_FAILOVER_ORDER` sets the ordered alternates.
- A provider is skipped when it is unconfigured, does not support the task capability, is explicitly excluded by the request circuit state, or is temporarily marked configuration-unhealthy.

## Failure and retry policy
- 429: honour a valid `Retry-After` value and perform at most one bounded retry on the same provider. If that provider remains rate-limited, switch to the next eligible provider. A long retry delay is not slept through when it exceeds the inline-wait or global-deadline budget.
- 503, 500, 502, 504 and 408: at most three calls to the current provider's primary model with exponential backoff and full jitter, then one configured same-provider model fallback when eligible, then cross-provider failover.
- Timeout: retry only while the shared request deadline permits. If the next backoff or `Retry-After` would consume the remaining deadline, skip the sleep and try another provider while time remains; stop only once the overall deadline is exhausted.
- Network failure: do not repeat the same unreachable request; try the next eligible provider.
- 401/403: mark that provider's configuration unhealthy for a five-minute process-local cooldown and try the next eligible provider. The active workflow endpoint also uses the persistent Gemini Supabase circuit. The process-local cooldown for other providers is an optimisation, not a durable cross-instance health record.
- 400/404/413/422 invalid requests: stop; do not send an identical invalid request to another provider.
- Safety rejection: preserve the rejection and never bypass it by switching providers. Both adapters check provider safety finish reasons, explicit refusal metadata, and clear refusal-text patterns before structured-output parsing.
- Invalid response/JSON/output: do not repeat the identical request against the same provider; switch to one other eligible provider. The workflow API retains its one bounded, separate schema-repair pass for registered node inputs.
- Cancellation, deadline exhaustion and attempt-budget exhaustion are terminal.

## Hard limits
- Default per-provider primary-model attempt limit: 3.
- At most one same-provider alternate-model attempt.
- Hard operation-wide provider attempt budget: 8 calls, even when a caller supplies a larger remaining budget.
- Hard per-provider operation budget: 4 calls across all gateway invocations (at most 3 calls to the primary model plus 1 alternate-model call).
- Workflow generation shares its existing 54-second deadline and both attempt caps across generation and schema repair.
- Standalone gateway calls receive a 30-second default deadline and an 8-attempt budget when the caller does not supply one.
- Provider candidates are de-duplicated and visited once per gateway request. The loop is finite; no recursive failover is used.

## Groq compatibility
- The adapter uses Groq's OpenAI-compatible Chat Completions endpoint and server-side `GROQ_API_KEY`.
- Default model is `openai/gpt-oss-120b`, with `openai/gpt-oss-20b` as the same-provider alternate; `GROQ_AI_MODEL` and `GROQ_FALLBACK_MODEL` can override them. Requests use the current `max_completion_tokens` parameter.
- Structured requests use JSON-object mode and Rexnora validation. This does not claim provider-enforced JSON-schema conformance.
- Text generation, structured JSON output, and tool-call response parsing are implemented. Tool calls are returned to the caller and are never executed inside the adapter.
- Credentials, prompts, response bodies, and raw provider errors are not included in diagnostic events.

## Provider health
- Authentication failures are exposed by `listProviders()` as an unhealthy provider during the five-minute cooldown held by that gateway instance. The production `aiGateway` singleton shares this process-local hint across requests in a warm instance; separately constructed gateway instances remain isolated.
- The workflow generation endpoint consults the persistent Gemini Supabase circuit before selecting a provider; if Gemini is cooling down or the circuit service is unavailable, Gemini is excluded and eligible alternates can still be tried.
- Persistent shared health state for Groq and Cloudflare has not yet been wired. Do not treat the process-local health hint as a cross-instance circuit breaker.

## Billing and workflow safety boundaries
The gateway reports normalized provider token usage only. It does not consume customer credits. Workflow generation retains registered-operation/input validation, graph topology, reachability, rebuild, and execution-step checks. The existing atomic `consume_ai_generation_usage` RPC remains after graph validation. Provider usage telemetry is recorded separately from customer credits. Generation remains draft-only: it never saves, activates, or executes a workflow.

## Remaining migration surfaces
Agent tool calling and tenant-owned Gemini connections used by real-estate qualification remain server-side. They are not redirected to the platform Gemini key; their credential ownership and approvals require separate migration work. Cloudflare stays disabled until a separate capability and quality gate passes.
