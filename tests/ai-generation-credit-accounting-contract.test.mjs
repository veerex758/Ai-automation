import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("../app/api/ai/generate-workflow/route.ts", import.meta.url), "utf8");

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
  assert.match(route, /AI_CREDIT_LIMIT_REACHED/);
  assert.match(route, /AI_SUBSCRIPTION_INACTIVE/);
});

test("provider and invalid-graph failures occur before customer credit metering", () => {
  const generation = route.indexOf("await generateWorkflow(");
  const metering = route.indexOf('supabase.rpc("consume_ai_generation_usage"');
  const catchBlock = route.indexOf("} catch (error)");
  assert.ok(generation >= 0 && metering > generation && catchBlock > metering);
  assert.match(route, /AI_PROVIDER_OVERLOADED/);
  assert.ok(route.includes('errorCode: Object.hasOwn(responses, code) ? code : "AI_PROVIDER_ERROR"'));
});


test("Gemini cooldown and repeated transient provider failures are gated before credit metering", () => {
  const circuitGate = route.indexOf('circuitClient.rpc("get_ai_provider_circuit_state"');
  const generation = route.indexOf("await generateWorkflow(");
  const circuitFailureWrite = route.indexOf('circuitClient.rpc("record_ai_provider_circuit_result"');
  const graphValidation = route.indexOf("validateRegisteredSteps(rebuilt)");
  const consume = route.indexOf('supabase.rpc("consume_ai_generation_usage"');
  assert.ok(circuitGate >= 0 && generation > circuitGate);
  assert.ok(circuitFailureWrite > generation && circuitFailureWrite < consume);
  assert.ok(graphValidation > generation && consume > graphValidation);
  assert.match(route, /AI_PROVIDER_COOLDOWN/);
  assert.match(route, /AI_PROVIDER_CIRCUIT_UNAVAILABLE/);
  assert.match(route, /No Rexnora AI credit was charged/);
  assert.equal((route.match(/consume_ai_generation_usage/g) || []).length, 1);
});
