import test from "node:test";
import assert from "node:assert/strict";
import { generateWorkflow, extractJson, validateRegistrySteps } from "../lib/workflows/ai-workflow-generator.cjs";

const catalog = [
  { id: "manual", name: "Manual", version: 1, auth: { type: "none" }, triggers: [{ id: "start", name: "Start", description: "Manual start", inputSchema: { type: "object", properties: {}, additionalProperties: true } }], actions: [] },
  { id: "gemini", name: "Gemini", version: 1, auth: { type: "apiKey", credentialKey: "apiKey" }, triggers: [], actions: [{ id: "generate_text", name: "Generate text", description: "Generate text", inputSchema: { type: "object", properties: { prompt: { type: "string", minLength: 1, maxLength: 12000 }, system: { type: "string", maxLength: 4000 }, model: { type: "string" }, maxOutputTokens: { type: "integer", minimum: 1, maximum: 4000 } }, required: ["prompt"], additionalProperties: false }] },
  { id: "slack", name: "Slack", version: 1, auth: { type: "apiKey", credentialKey: "webhookUrl" }, triggers: [], actions: [{ id: "send_message", name: "Send message", description: "Send message", inputSchema: { type: "object", properties: { message: { type: "string", minLength: 1, maxLength: 4000 } }, required: ["message"], additionalProperties: false } }] },
];
const validSteps = [
  { id: "start", nodeId: "manual", operationId: "start", kind: "trigger", input: {} },
  { id: "ai", nodeId: "gemini", operationId: "generate_text", kind: "action", input: { prompt: "Qualify this lead", model: "gemini-2.5-flash", maxOutputTokens: 300 } },
];
const env = { AIVANTA_AI_API_KEY: "test-secret", AIVANTA_AI_BASE_URL: "https://ai.example.test/v1", AIVANTA_AI_MODEL: "test-model", NODE_ENV: "test" };
const fakeFetch = (payload, status = 200) => async (_url, options) => {
  assert.equal(options.headers.Authorization, "Bearer test-secret");
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
};
const providerPayload = (steps = validSteps) => ({ choices: [{ message: { content: JSON.stringify({ registrySteps: steps }) } }] });

test("extracts JSON and optional markdown fences safely", () => {
  const fence = String.fromCharCode(96).repeat(3);
  assert.deepEqual(extractJson(JSON.stringify({ registrySteps: validSteps })), { registrySteps: validSteps });
  assert.deepEqual(extractJson(fence + "json\\n" + JSON.stringify({ registrySteps: validSteps }) + "\\n" + fence), { registrySteps: validSteps });
  assert.throws(() => extractJson("not json"), /AI_INVALID_JSON/);
});
test("rejects empty and oversized prompts before calling provider", async () => {
  await assert.rejects(generateWorkflow({ prompt: " ", env, nodeCatalog: catalog }), /AI_PROMPT_REQUIRED/);
  await assert.rejects(generateWorkflow({ prompt: "x".repeat(2001), env, nodeCatalog: catalog }), /AI_PROMPT_TOO_LONG/);
});
test("requires server-side AI credentials and a live node catalog", async () => {
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env: {}, nodeCatalog: catalog }), /AI_NOT_CONFIGURED/);
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env, nodeCatalog: [] }), /AI_NODE_CATALOG_UNAVAILABLE/);
});
test("generates registry-native workflows using any supplied registered node", async () => {
  const result = await generateWorkflow({ prompt: "Qualify leads with Gemini", env, nodeCatalog: catalog, fetchImpl: fakeFetch(providerPayload()) });
  assert.equal(result.registrySteps[1].nodeId, "gemini");
  assert.equal(result.registrySteps[1].operationId, "generate_text");
  assert.equal(result.definition.nodes[0].settings.event, "manual");
  assert.equal(result.saved, false);
  assert.equal(result.executed, false);
});
test("rejects unknown node IDs, operations, invalid schemas and misplaced triggers", async () => {
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env, nodeCatalog: catalog, fetchImpl: fakeFetch(providerPayload([{ ...validSteps[0] }, { ...validSteps[1], nodeId: "not-installed" }])) }), /AI_UNSAFE_WORKFLOW/);
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env, nodeCatalog: catalog, fetchImpl: fakeFetch(providerPayload([{ ...validSteps[0] }, { ...validSteps[1], input: { prompt: "x", secret: "do-not-allow" } }])) }), /AI_UNSAFE_WORKFLOW/);
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env, nodeCatalog: catalog, fetchImpl: fakeFetch(providerPayload([validSteps[1], validSteps[0]])) }), /AI_UNSAFE_WORKFLOW/);
});
test("registry validation requires exactly one trigger and unique IDs", () => {
  assert.equal(validateRegistrySteps(validSteps, catalog).length, 2);
  assert.equal(validateRegistrySteps([validSteps[0], { ...validSteps[1], id: "start" }], catalog), null);
  assert.equal(validateRegistrySteps([validSteps[1]], catalog), null);
});
test("classifies provider authorization, throttling, and generic errors safely", async () => {
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env, nodeCatalog: catalog, fetchImpl: fakeFetch({}, 401) }), /AI_PROVIDER_AUTH_ERROR/);
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env, nodeCatalog: catalog, fetchImpl: fakeFetch({}, 403) }), /AI_PROVIDER_AUTH_ERROR/);
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env, nodeCatalog: catalog, fetchImpl: fakeFetch({}, 429) }), /AI_RATE_LIMITED/);
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env, nodeCatalog: catalog, fetchImpl: fakeFetch({}, 500) }), /AI_PROVIDER_ERROR/);
});
test("rejects malformed provider payloads and empty model output", async () => {
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env, nodeCatalog: catalog, fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error("invalid JSON"); } }) }), /AI_INVALID_RESPONSE/);
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env, nodeCatalog: catalog, fetchImpl: fakeFetch({ choices: [] }) }), /AI_EMPTY_RESPONSE/);
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env, nodeCatalog: catalog, fetchImpl: fakeFetch({ choices: [{ message: { content: "not JSON" } }] }) }), /AI_INVALID_JSON/);
});
test("classifies provider transport failures and timeouts", async () => {
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env, nodeCatalog: catalog, fetchImpl: async () => { throw new Error("offline"); } }), /AI_PROVIDER_UNAVAILABLE/);
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env, nodeCatalog: catalog, fetchImpl: async () => { const error = new Error("timeout"); error.name = "AbortError"; throw error; } }), /AI_TIMEOUT/);
});
test("rejects invalid model names and non-HTTPS provider endpoints in production", async () => {
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env: { ...env, AIVANTA_AI_MODEL: "invalid model!" }, nodeCatalog: catalog }), /AI_CONFIGURATION_ERROR/);
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env: { ...env, AIVANTA_AI_BASE_URL: "http://ai.example.test", NODE_ENV: "production" }, nodeCatalog: catalog }), /AI_CONFIGURATION_ERROR/);
});
