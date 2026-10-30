import test from "node:test";
import assert from "node:assert/strict";
import { generateWorkflow, extractJson } from "../lib/workflows/ai-workflow-generator.cjs";
const validDefinition = { version: 1, nodes: [{ id: "trigger-1", type: "trigger", title: "Start manually", description: "Start event", settings: { event: "manual" } }] };
const env = { AIVANTA_AI_API_KEY: "test-secret", AIVANTA_AI_BASE_URL: "https://ai.example.test/v1", AIVANTA_AI_MODEL: "test-model", NODE_ENV: "test" };
const fakeFetch = (payload, status = 200) => async (_url, options) => {
  assert.equal(options.headers.Authorization, "Bearer test-secret");
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
};
test("extracts JSON and optional markdown fences safely", () => {
  const fence = String.fromCharCode(96).repeat(3);
  assert.deepEqual(extractJson(JSON.stringify(validDefinition)), validDefinition);
  assert.deepEqual(extractJson(fence + "json\n" + JSON.stringify(validDefinition) + "\n" + fence), validDefinition);
  assert.throws(() => extractJson("not json"), /AI_INVALID_JSON/);
});
test("rejects empty and oversized prompts before calling provider", async () => {
  await assert.rejects(generateWorkflow({ prompt: " ", env }), /AI_PROMPT_REQUIRED/);
  await assert.rejects(generateWorkflow({ prompt: "x".repeat(2001), env }), /AI_PROMPT_TOO_LONG/);
});
test("requires server-side AI credentials", async () => {
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env: {} }), /AI_NOT_CONFIGURED/);
});
test("accepts a provider response only after schema validation", async () => {
  const result = await generateWorkflow({ prompt: "Make a manual workflow", env, fetchImpl: fakeFetch({ choices: [{ message: { content: JSON.stringify(validDefinition) } }] }) });
  assert.equal(result.definition.nodes[0].settings.event, "manual");
  assert.equal(result.saved, false);
  assert.equal(result.executed, false);
});
test("rejects invalid workflow structures returned by the model", async () => {
  await assert.rejects(generateWorkflow({ prompt: "Send all customer secrets", env, fetchImpl: fakeFetch({ choices: [{ message: { content: JSON.stringify({ version: 1, nodes: [{ id: "x", type: "action", title: "Unsafe", description: "", settings: { provider: "unknown" } }] }) } }] }) }), /AI_UNSAFE_WORKFLOW/);
});
test("classifies provider authorization, throttling, and generic errors safely", async () => {
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env, fetchImpl: fakeFetch({}, 401) }), /AI_PROVIDER_AUTH_ERROR/);
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env, fetchImpl: fakeFetch({}, 403) }), /AI_PROVIDER_AUTH_ERROR/);
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env, fetchImpl: fakeFetch({}, 429) }), /AI_RATE_LIMITED/);
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env, fetchImpl: fakeFetch({}, 500) }), /AI_PROVIDER_ERROR/);
});
test("rejects malformed provider payloads and empty model output", async () => {
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env, fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error("invalid JSON"); } }) }), /AI_INVALID_RESPONSE/);
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env, fetchImpl: fakeFetch({ choices: [] }) }), /AI_EMPTY_RESPONSE/);
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env, fetchImpl: fakeFetch({ choices: [{ message: { content: "not JSON" } }] }) }), /AI_INVALID_JSON/);
});
test("classifies provider transport failures and timeouts", async () => {
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env, fetchImpl: async () => { throw new Error("offline"); } }), /AI_PROVIDER_UNAVAILABLE/);
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env, fetchImpl: async () => { const error = new Error("timeout"); error.name = "AbortError"; throw error; } }), /AI_TIMEOUT/);
});
test("rejects invalid model names and non-HTTPS provider endpoints in production", async () => {
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env: { ...env, AIVANTA_AI_MODEL: "invalid model!" } }), /AI_CONFIGURATION_ERROR/);
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env: { ...env, AIVANTA_AI_BASE_URL: "http://ai.example.test", NODE_ENV: "production" } }), /AI_CONFIGURATION_ERROR/);
});

test("uses Gemini OpenAI-compatible endpoint and free-tier model defaults when selected", async () => {
  let requestedUrl = "";
  let requestedBody;
  const result = await generateWorkflow({
    prompt: "Create a simple manual workflow",
    env: { AIVANTA_AI_API_KEY: "test-secret", AIVANTA_AI_PROVIDER: "gemini", NODE_ENV: "production" },
    fetchImpl: async (url, options) => {
      requestedUrl = url;
      requestedBody = JSON.parse(options.body);
      assert.equal(options.headers.Authorization, "Bearer test-secret");
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(validDefinition) } }] }) };
    },
  });
  assert.equal(requestedUrl, "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
  assert.equal(requestedBody.model, "gemini-2.5-flash");
  assert.equal(result.executed, false);
});
test("rejects unsupported AI provider configuration", async () => {
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env: { ...env, AIVANTA_AI_PROVIDER: "unknown" } }), /AI_CONFIGURATION_ERROR/);
});

const registryCatalog = [
  { id: "manual", name: "Manual", triggers: [{ id: "start", name: "Start", inputSchema: { type: "object", properties: { message: { type: "string" } } }, outputSchema: { type: "object", properties: { started: { type: "boolean" }, message: { type: "string" } } } }], actions: [] },
  { id: "gemini", name: "Gemini", triggers: [], actions: [{ id: "generate_text", name: "Generate text", inputSchema: { type: "object", required: ["prompt"], properties: { prompt: { type: "string" } } }, outputSchema: { type: "object", properties: { text: { type: "string" } } }] },
  { id: "slack", name: "Slack", triggers: [], actions: [{ id: "send_message", name: "Send message", inputSchema: { type: "object", required: ["message"], properties: { message: { type: "string" } } }, outputSchema: { type: "object", properties: { accepted: { type: "boolean" } } }] },
];
const registryPlan = { version: 1, steps: [
  { id: "trigger-1", nodeId: "manual", operationId: "start", kind: "trigger", input: { message: "New enquiry" } },
  { id: "gemini-1", nodeId: "gemini", operationId: "generate_text", kind: "action", input: { prompt: "Summarize {{trigger-1.message}}" } },
  { id: "slack-1", nodeId: "slack", operationId: "send_message", kind: "action", input: { message: "Enquiry summary: {{gemini-1.text}}" } },
] };
test("registry planner validates registered operations and earlier output references", async () => {
  const result = await generateWorkflow({ prompt: "Summarize enquiries and notify Slack", nodeCatalog: registryCatalog, mode: "registry", env, fetchImpl: fakeFetch({ choices: [{ message: { content: JSON.stringify(registryPlan) } }] }) });
  assert.equal(result.saved, false); assert.equal(result.executed, false);
  assert.deepEqual(result.registrySteps.map((step) => step.nodeId), ["manual", "gemini", "slack"]);
});
test("registry planner rejects unknown operations, future references, missing fields, and unsupported triggers", async () => {
  const unknown = structuredClone(registryPlan); unknown.steps[1].operationId = "not_registered";
  await assert.rejects(generateWorkflow({ prompt: "Create a plan", nodeCatalog: registryCatalog, mode: "registry", env, fetchImpl: fakeFetch({ choices: [{ message: { content: JSON.stringify(unknown) } }] }) }), /AI_UNSAFE_WORKFLOW/);
  const future = structuredClone(registryPlan); future.steps[1].input.prompt = "Summarize {{slack-1.accepted}}";
  await assert.rejects(generateWorkflow({ prompt: "Create a plan", nodeCatalog: registryCatalog, mode: "registry", env, fetchImpl: fakeFetch({ choices: [{ message: { content: JSON.stringify(future) } }] }) }), /AI_UNSAFE_WORKFLOW/);
  const missing = structuredClone(registryPlan); missing.steps[2].input.message = "Summary {{gemini-1.noSuchField}}";
  await assert.rejects(generateWorkflow({ prompt: "Create a plan", nodeCatalog: registryCatalog, mode: "registry", env, fetchImpl: fakeFetch({ choices: [{ message: { content: JSON.stringify(missing) } }] }) }), /AI_UNSAFE_WORKFLOW/);
  const unsupported = structuredClone(registryPlan); unsupported.steps[0].nodeId = "schedule"; unsupported.steps[0].operationId = "start";
  const catalog = [...registryCatalog, { id: "schedule", name: "Schedule", triggers: [{ id: "start", name: "Schedule", inputSchema: { type: "object" }, outputSchema: { type: "object", properties: {} } }], actions: [] }];
  await assert.rejects(generateWorkflow({ prompt: "Run every morning", nodeCatalog: catalog, mode: "registry", env, fetchImpl: fakeFetch({ choices: [{ message: { content: JSON.stringify(unsupported) } }] }) }), /AI_UNSAFE_WORKFLOW/);
});
