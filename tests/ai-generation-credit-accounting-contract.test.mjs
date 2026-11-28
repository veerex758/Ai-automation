import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("../app/api/ai/generate-workflow/route.ts", import.meta.url), "utf8");
const gateway = readFileSync(new URL("../lib/ai/gateway.ts", import.meta.url), "utf8");
const circuitStore = readFileSync(new URL("../lib/ai/circuit-breaker.ts", import.meta.url), "utf8");
const usageModule = readFileSync(new URL("../lib/ai/usage.ts", import.meta.url), "utf8");
const reservationMigration = readFileSync(new URL("../supabase/migrations/20261128130000_rexnora_ai_generation_credit_reservations.sql", import.meta.url), "utf8");

test("workflow generation reserves before provider work and consumes only after the complete graph validates", () => {
  const preflight = route.indexOf('supabase.rpc("get_workspace_entitlements"');
  const reservation = route.indexOf('supabase.rpc("reserve_ai_generation_usage"');
  const generation = route.indexOf("await generateWorkflow(");
  const graphValidation = route.indexOf("validateRegisteredSteps(rebuilt)");
  const metering = route.indexOf('supabase.rpc("consume_ai_generation_usage"');
  const successLog = route.indexOf('outcome: "success"');
  assert.ok(preflight >= 0 && reservation > preflight);
  assert.ok(generation > reservation);
  assert.ok(graphValidation > generation);
  assert.ok(metering > graphValidation);
  assert.ok(successLog > metering);
  assert.equal((route.match(/reserve_ai_generation_usage/g) || []).length, 1);
  assert.equal((route.match(/consume_ai_generation_usage/g) || []).length, 1);
  assert.equal((route.match(/release_ai_generation_usage/g) || []).length, 1);
  assert.match(route, /AI_CREDIT_LIMIT_REACHED/);
  assert.match(route, /Your AI credit was not charged/);
  assert.match(route, /AI_SUBSCRIPTION_INACTIVE/);
});

test("all provider attempts, schema repair, reservation and settlement share one logical operation ID", () => {
  assert.match(route, /Idempotency-Key/);
  assert.match(route, /const operationId = suppliedOperationId/);
  assert.match(route, /operationId,\s*signal: request\.signal/);
  assert.match(route, /p_operation_id: operationId/);
  assert.match(route, /p_request_fingerprint: requestFingerprint/);
  assert.match(route, /createHash\("sha256"\)/);
  assert.match(route, /p_provider_usage: Array\.from\(providerUsageByModel\.values\(\)\)/);
});

test("a failed or malformed generation releases the hold in finally without consuming usage", () => {
  const reserve = route.indexOf('supabase.rpc("reserve_ai_generation_usage"');
  const consume = route.indexOf('supabase.rpc("consume_ai_generation_usage"');
  const catchBlock = route.indexOf("} catch (error)");
  const finallyBlock = route.lastIndexOf("} finally");
  const release = route.indexOf('supabase.rpc("release_ai_generation_usage"');
  assert.ok(reserve >= 0 && consume > reserve);
  assert.ok(catchBlock > consume && finallyBlock > catchBlock && release > finallyBlock);
  assert.match(route, /if \(releaseReservation && !reservationConsumed\)/);
  assert.match(reservationMigration, /expires_at timestamptz not null default now\(\) \+ interval '10 minutes'/);
});

test("provider and invalid-graph failures occur before customer credit metering", () => {
  const gatewayInvocation = route.indexOf("await aiGateway.generateStructured(");
  const generation = route.indexOf("await generateWorkflow(");
  const metering = route.indexOf('supabase.rpc("consume_ai_generation_usage"');
  const catchBlock = route.indexOf("} catch (error)");
  assert.ok(gatewayInvocation >= 0 && generation > gatewayInvocation);
  assert.ok(metering > generation && catchBlock > metering);
  assert.match(route, /AI_PROVIDER_OVERLOADED/);
  assert.match(route, /AI_PROVIDER_COOLDOWN/);
  assert.ok(route.includes('errorCode: Object.hasOwn(responses, code) ? code : "AI_PROVIDER_ERROR"'));
});

test("shared per-provider circuits gate generation and repair before the single credit charge site", () => {
  const gatewayInvocation = route.indexOf("await aiGateway.generateStructured(");
  const generation = route.indexOf("await generateWorkflow(");
  const repair = route.indexOf("await repairRegistryStepInputs(");
  const validation = route.indexOf("validateRegisteredSteps(rebuilt)");
  const metering = route.indexOf('supabase.rpc("consume_ai_generation_usage"');

  assert.ok(gatewayInvocation >= 0 && generation > gatewayInvocation);
  assert.ok(repair > generation && validation > repair && metering > validation);
  assert.match(route, /AI_PROVIDER_CIRCUIT_UNAVAILABLE/);
  assert.match(route, /No Rexnora AI credit was charged/);
  assert.match(gateway, /await circuitStore\.acquire\(provider\.id, policy\)/);
  assert.match(gateway, /if \(!admission\.allowed\)/);
  assert.match(gateway, /Never bypass shared-health storage failure/);
  assert.match(circuitStore, /class SupabaseCircuitBreakerStore/);
  assert.equal((route.match(/consume_ai_generation_usage/g) || []).length, 1);
  assert.doesNotMatch(route, /circuitClient\.rpc\("get_ai_provider_circuit_state"/);
});

test("provider telemetry remains separate from customer credit accounting", () => {
  assert.doesNotMatch(usageModule, /consume_ai_generation_usage/);
  assert.match(usageModule, /Provider token\/cost telemetry only/);
});


test("provider usage is collected per actual provider/model, not charged as separate customer credits", () => {
  assert.match(route, /providerUsageByModel = new Map/);
  assert.match(route, /recordedUsage\.inputTokens \+= result\.usage\.inputTokens/);
  assert.match(route, /recordedUsage\.outputTokens \+= result\.usage\.outputTokens/);
  assert.match(route, /recordedUsage\.fallbackUsed \|\|= result\.fallbackUsed/);
  assert.match(route, /p_provider_usage: Array\.from\(providerUsageByModel\.values\(\)\)/);
  assert.equal((route.match(/consume_ai_generation_usage/g) || []).length, 1);
  assert.doesNotMatch(usageModule, /consume_ai_generation_usage/);
});

test("shared AI provider attempts keep using the same operation identifier across retries and repair", () => {
  assert.match(gateway, /operationId: context\.operationId/);
  assert.match(gateway, /withProviderRetries/);
  assert.match(route, /operationId,\s*signal: request\.signal/);
  assert.match(route, /await repairRegistryStepInputs\([\s\S]*onProviderAttempt,[\s\S]*gatewayGenerateStructured/);
});


test("ambiguous settlement responses are resolved with the same operation reservation state", () => {
  assert.match(route, /AI_USAGE_SETTLEMENT_UNKNOWN/);
  assert.match(route, /releaseResult\?\.reason !== "already_consumed"/);
  assert.match(route, /releaseResult\?\.released === true \|\| releaseResult\?\.reason === "already_released"/);
  assert.match(route, /if \(releaseResult\?\.reason !== "already_consumed"\)/);
  assert.match(route, /Reuse the same Idempotency-Key/);
  assert.doesNotMatch(route, /Usage settlement is unavailable\. Your AI credit was not charged/);
});
