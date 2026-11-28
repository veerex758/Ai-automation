import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20261128100000_rexnora_gemini_provider_circuit_breaker.sql", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/ai/generate-workflow/route.ts", import.meta.url), "utf8");

test("Gemini circuit state is persisted in a shared private database table", () => {
  assert.match(migration, /create table if not exists private\.ai_provider_circuit_breakers/);
  assert.match(migration, /provider text primary key check \(provider = 'gemini'\)/);
  assert.match(migration, /alter table private\.ai_provider_circuit_breakers enable row level security/);
  assert.match(migration, /revoke all on private\.ai_provider_circuit_breakers from public, anon, authenticated, service_role/);
  assert.match(migration, /for update/);
  assert.match(migration, /probe_until = v_now \+ interval '25 seconds'/);
});

test("only the server service role can read or mutate circuit state", () => {
  assert.match(migration, /coalesce\(\(select auth\.jwt\(\) ->> 'role'\), ''\) <> 'service_role'/);
  assert.match(migration, /security definer[\s\S]*?set search_path = ''/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /grant execute on function public\.get_ai_provider_circuit_state\(text\) to service_role/);
  assert.match(migration, /grant execute on function public\.record_ai_provider_circuit_result\(text, boolean, integer, bigint, boolean\) to service_role/);
  assert.match(migration, /from public, anon, authenticated/);
  assert.doesNotMatch(migration, /grant execute on function public\.get_ai_provider_circuit_state\(text\) to authenticated/);
  assert.match(route, /import \{ createAdminClient \} from "@\/lib\/supabase\/admin"/);
  assert.match(route, /const circuitClient = createAdminClient\(\)|circuitClient = createAdminClient\(\)/);
});

test("Gemini cooldown opens on sustained transient failures or an immediate 429", () => {
  assert.match(migration, /p_status_code = 429 or v_failures >= 2 or p_probe/);
  assert.match(migration, /p_status_code is null or p_status_code in \(408, 429, 500, 502, 503, 504\)/);
  assert.match(migration, /least\(600000, greatest\(30000, coalesce\(p_retry_after_ms, 0\)\)\)/);
  assert.match(migration, /least\(300000, 30000 \* \(2 \^ least\(v_row\.open_count, 4\)\)\)/);
});

test("half-open circuit permits one leased probe and late success cannot close a new open circuit", () => {
  assert.match(migration, /v_row\.probe_until > v_now/);
  assert.match(migration, /set probe_until = v_now \+ interval '25 seconds'/);
  assert.match(migration, /Only the half-open probe may close an already-open circuit/);
  assert.match(migration, /if v_row\.open_until is null or p_probe then/);
  assert.match(route, /p_probe: circuitProbe/);
});

test("API fails closed when circuit storage is unavailable and does not bill cooldown rejections", () => {
  const gate = route.indexOf('circuitClient.rpc("get_ai_provider_circuit_state"');
  const generation = route.indexOf("await generateWorkflow(");
  const metering = route.indexOf('supabase.rpc("consume_ai_generation_usage"');
  assert.ok(gate >= 0 && generation > gate && metering > generation);
  assert.match(route, /AI_PROVIDER_CIRCUIT_UNAVAILABLE/);
  assert.match(route, /AI_PROVIDER_COOLDOWN/);
  assert.match(route, /Retry-After/);
});
