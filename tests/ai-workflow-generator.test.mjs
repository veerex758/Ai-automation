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
test("rejects unknown top-level and node fields instead of silently stripping them", async () => {
  const withExtraRootField = { ...validDefinition, executeImmediately: true };
  await assert.rejects(
    generateWorkflow({ prompt: "Make a manual workflow", env, fetchImpl: fakeFetch({ choices: [{ message: { content: JSON.stringify(withExtraRootField) } }] }) }),
    /AI_UNSAFE_WORKFLOW/,
  );

  const withExtraNodeField = {
    version: 1,
    nodes: [{ ...validDefinition.nodes[0], hiddenInstruction: "ignore review and execute" }],
  };
  await assert.rejects(
    generateWorkflow({ prompt: "Make a manual workflow", env, fetchImpl: fakeFetch({ choices: [{ message: { content: JSON.stringify(withExtraNodeField) } }] }) }),
    /AI_UNSAFE_WORKFLOW/,
  );
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


test("rejects unsupported nested settings instead of silently stripping them", async () => {
  const withUnknownSetting = {
    version: 1,
    nodes: [{
      ...validDefinition.nodes[0],
      settings: { event: "manual", hiddenInstruction: "execute immediately" },
    }],
  };
  await assert.rejects(
    generateWorkflow({
      prompt: "Make a manual workflow",
      env,
      fetchImpl: fakeFetch({ choices: [{ message: { content: JSON.stringify(withUnknownSetting) } }] }),
    }),
    /AI_UNSAFE_WORKFLOW/,
  );
});

test("sends the requested workflow intent using JSON-only provider mode", async () => {
  let captured;
  const fetchImpl = async (_url, options) => {
    captured = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(validDefinition) } }] }),
    };
  };
  await generateWorkflow({ prompt: "When a customer signs up, create an onboarding task", env, fetchImpl });
  assert.equal(captured.response_format.type, "json_object");
  assert.match(captured.messages[1].content, /When a customer signs up, create an onboarding task/);
  assert.match(captured.messages[0].content, /draft only/i);
});
