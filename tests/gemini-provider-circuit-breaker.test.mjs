import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const baseMigration = readFileSync(new URL("../supabase/migrations/20261128100000_rexnora_gemini_provider_circuit_breaker.sql", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20261128110000_rexnora_multi_provider_ai_circuit_breaker.sql", import.meta.url), "utf8");
const gateway = readFileSync(new URL("../lib/ai/gateway.ts", import.meta.url), "utf8");
const store = readFileSync(new URL("../lib/ai/circuit-breaker.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/ai/generate-workflow/route.ts", import.meta.url), "utf8");

test("shared circuit state is persisted independently for every platform AI provider", () => {
  assert.match(migration, /create table if not exists private\.ai_provider_circuit_breakers/);
  assert.match(migration, /provider in \('gemini', 'groq', 'cloudflare'\)/);
  assert.match(migration, /values \('gemini'\), \('groq'\), \('cloudflare'\)/);
  assert.match(migration, /create table if not exists private\.ai_provider_circuit_events/);
  assert.match(migration, /on private\.ai_provider_circuit_events\(provider, occurred_at desc\)/);
  assert.match(migration, /alter table private\.ai_provider_circuit_breakers enable row level security/);
  assert.match(migration, /alter table private\.ai_provider_circuit_events enable row level security/);
  assert.match(store, /class SupabaseCircuitBreakerStore/);
  assert.match(gateway, /new SupabaseCircuitBreakerStore\(\)/);
  assert.match(gateway, /new InMemoryCircuitBreakerStore\(\)/);
});

test("provider circuits use a rolling failure-rate window and configurable open thresholds", () => {
  assert.match(migration, /p_failure_threshold integer default 3/);
  assert.match(migration, /p_failure_rate_threshold numeric default 0\.5/);
  assert.match(migration, /p_minimum_requests integer default 5/);
  assert.match(migration, /p_window_seconds integer default 300/);
  assert.match(migration, /recent_failure_rate = v_failure_rate/);
  assert.match(migration, /v_attempts >= p_minimum_requests and v_failure_rate >= p_failure_rate_threshold/);
  assert.match(gateway, /AI_CIRCUIT_FAILURE_THRESHOLD/);
  assert.match(gateway, /AI_CIRCUIT_FAILURE_RATE_THRESHOLD/);
  assert.match(gateway, /AI_CIRCUIT_WINDOW_SECONDS/);
});

test("only the server service role can access provider circuit state", () => {
  assert.match(migration, /coalesce\(\(select auth\.jwt\(\) ->> 'role'\), ''\) <> 'service_role'/);
  assert.match(migration, /security definer[\s\S]*?set search_path = ''/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /grant execute on function public\.get_ai_provider_circuit_state\(text\) to service_role/);
  assert.match(migration, /grant execute on function public\.record_ai_provider_circuit_result\([\s\S]*?to service_role/);
  assert.match(migration, /from public, anon, authenticated/);
  assert.doesNotMatch(migration, /grant execute on function public\.get_ai_provider_circuit_state\(text\) to authenticated/);
  assert.match(store, /createAdminClient\(\)/);
  assert.match(store, /AI_PROVIDER_CIRCUIT_UNAVAILABLE/);
});

test("half-open circuit leases one health probe and only that probe can close an open circuit", () => {
  assert.match(migration, /probe_until > v_now/);
  assert.match(migration, /set probe_until = v_now \+ interval '25 seconds'/);
  assert.match(migration, /Only the acquired half-open probe may close it/);
  assert.match(migration, /if v_row\.open_until is null or p_probe then/);
  assert.match(gateway, /if \(admission\.probe\)/);
  assert.match(gateway, /no retry burst/);
  assert.match(migration, /p_probe/);
});

test("429 and invalid provider credentials open a provider-specific circuit", () => {
  assert.match(migration, /p_status_code in \(401, 403, 429\)/);
  assert.match(migration, /p_status_code = 429/);
  assert.match(migration, /p_auth_cooldown_ms bigint default 300000/);
  assert.match(migration, /least\(600000, greatest\(1000,/);
  assert.match(gateway, /AI_CIRCUIT_AUTH_COOLDOWN_MS/);
});

test("workflow generation fails closed when shared health storage is unavailable and returns Retry-After for cooldown", () => {
  assert.match(gateway, /Never bypass shared-health storage failure/);
  assert.match(gateway, /AI_PROVIDER_CIRCUIT_UNAVAILABLE/);
  assert.match(route, /AI_PROVIDER_CIRCUIT_UNAVAILABLE/);
  assert.match(route, /AI_PROVIDER_COOLDOWN/);
  assert.match(route, /response\.headers\.set\("Retry-After"/);
  const generation = route.indexOf("await generateWorkflow(");
  const metering = route.indexOf('supabase.rpc("consume_ai_generation_usage"');
  assert.ok(generation >= 0 && metering > generation);
});
