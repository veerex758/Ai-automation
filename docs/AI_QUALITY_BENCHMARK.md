# Rexnora AI model quality benchmark

Phase 4 keeps model quality qualification separate from provider availability and circuit health. A provider can be healthy and still be ineligible for a specific task.

## Run a real benchmark

Run one provider, model, and task at a time after deploying migration
`20261128130000_rexnora_ai_model_quality_qualification.sql` to the benchmark database:

```sh
AI_PRIMARY_PROVIDER=gemini npm run benchmark:ai-quality -- --task=lead_qualification --provider=gemini
AI_PRIMARY_PROVIDER=groq npm run benchmark:ai-quality -- --task=lead_qualification --provider=groq --model=openai/gpt-oss-120b
```

A run executes all 20 independently graded cases for the selected task, then performs at least
three recovery probes. Each recovery probe injects one controlled transient 503 at the provider
adapter boundary and checks that the production gateway's bounded retry path recovers. It does
not fabricate task accuracy or claim an external provider outage occurred.

The runner records actual request latency, the adapter's provider-reported cost when available,
and token-derived cost only when an operator supplies an explicit pricing record. Configure
`AI_QUALITY_PRICING_JSON` with exact provider/model keys:

```json
{
  "gemini/gemini-3.8-flash": {
    "inputUsdPer1MTokens": 0.1,
    "outputUsdPer1MTokens": 0.4
  },
  "groq/openai/gpt-oss-120b": {
    "inputUsdPer1MTokens": 0.1,
    "outputUsdPer1MTokens": 0.4
  }
}
```

The values above are formatting examples only, not current price claims. Use provider pricing that
you have independently verified for the exact model and date. Without provider-reported cost or
a configured price, cost remains null and the model cannot qualify. Missing costs are never
treated as zero.

Persistence requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the secure benchmark
environment. Use `--dry-run` to evaluate without writing qualification records. Never place
provider keys or Supabase service-role credentials in source control.

## Qualification policy

All eight tasks have their own 20-case dataset and threshold policy:
workflow generation, workflow schema repair, workflow debugging, lead qualification, email
drafting, data extraction, summarization, and agent tool calling. The metrics include task
accuracy, schema validity where applicable, workflow graph correctness where applicable,
tool-call accuracy where applicable, p95 latency, cost per successful operation, and recovery
rate.

The recovery rate denominator is every attempted controlled probe, not only successful probes.
At least three probes are required. Task sample count excludes recovery probes. A model is only
eligible when every applicable current threshold passes.

Qualification records are keyed by provider, model, task, and benchmark version. The gateway
rechecks metrics against the code's current thresholds at routing time; a row's stored
`eligible` flag alone is not trusted. Alternate models and providers require a matching
qualification for the exact task and benchmark version. If the quality store is unavailable,
the gateway retains only the configured primary route and disables automatic quality-based
alternatives. Set `AI_QUALITY_REQUIRE_PRIMARY_QUALIFICATION=true` to block even an unqualified
primary model.

The production benchmark runner does not run in CI and CI does not seed qualifications. Unit
tests validate the datasets, graders, metrics, persistence contract, and routing policy without
spending provider tokens. Real provider qualifications must be explicitly run and persisted.
