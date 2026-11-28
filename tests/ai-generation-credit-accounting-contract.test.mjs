import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("../app/api/ai/generate-workflow/route.ts", import.meta.url), "utf8");
const gateway = readFileSync(new URL("../lib/ai/gateway.ts", import.meta.url), "utf8");
const circuitStore = readFileSync(new URL("../lib/ai/circuit-breaker.ts", import.meta.url), "utf8");
const usageModule = readFileSync(new URL("../lib/ai/usage.ts", import.meta.url), "utf8");

test("workflow generation meters one AI credit only after a complete validated graph exists", () => {
  const preflight = route.indexOf('supabase.rpc("get_workspace_entitlements"');
  const generation = route.indexOf("await generateWorkflow(");
  const graphValidation = route.indexOf("validateRegisteredSteps(rebuilt)");
  const metering = route.indexOf('supabase.rpc("consume_ai_generation_usage"');
  const successLog = route.indexOf('outcome: "success"');
  assert.ok(preflight >= 0 && generation > preflight);
  assert.ok(graphValidation > generation);
  assert.ok(metering > graphValidation);
  assert.ok(successLog > metering);
  assert.equal((route.match(/consume_ai_generation_usage/g) || []).length, 1);
  assert.match(route, /AI_CREDIT_LIMIT_REACHED/);
  assert.match(route, /Your AI credit was not charged/);
  assert.match(route, /AI_SUBSCRIPTION_INACTIVE/);
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
