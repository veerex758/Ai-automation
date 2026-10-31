import test from "node:test";
import assert from "node:assert/strict";
import { generateWorkflow, extractJson, getProviderConfig } from "../lib/workflows/ai-workflow-generator.cjs";

const validDefinition = { version: 1, nodes: [{ id: "trigger-1", type: "trigger", title: "Start manually", description: "Start event", settings: { event: "manual" } }] };
const env = { AIVANTA_AI_PROVIDER: "openai", AIVANTA_AI_API_KEY: "test-secret", AIVANTA_AI_BASE_URL: "https://ai.example.test/v1", AIVANTA_AI_MODEL: "test-model", NODE_ENV: "test" };
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
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env: { AIVANTA_AI_PROVIDER: "gemini" } }), /AI_NOT_CONFIGURED/);
});
test("preserves OpenAI-compatible endpoint, model, and Bearer auth", async () => {
  const result = await generateWorkflow({
    prompt: "Make a manual workflow", env,
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://ai.example.test/v1/chat/completions");
      assert.equal(options.headers.Authorization, "Bearer test-secret");
      const request = JSON.parse(options.body);
      assert.equal(request.model, "test-model");
      assert.deepEqual(request.response_format, { type: "json_object" });
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(validDefinition) } }] }) };
    }
  });
  assert.equal(result.definition.nodes[0].settings.event, "manual");
  assert.equal(result.saved, false);
  assert.equal(result.executed, false);
});
test("uses Gemini generateContent endpoint, API-key header, model, and JSON response mode", async () => {
  const geminiEnv = { GEMINI_API_KEY: "gemini-test-secret", AIVANTA_AI_PROVIDER: "gemini", NODE_ENV: "test" };
  const result = await generateWorkflow({
    prompt: "Make a manual workflow", env: geminiEnv,
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
      assert.equal(options.headers["x-goog-api-key"], "gemini-test-secret");
      assert.equal(url.includes("gemini-test-secret"), false);
      const request = JSON.parse(options.body);
      assert.equal(request.generationConfig.responseMimeType, "application/json");
      assert.equal(request.systemInstruction.parts[0].text.includes("workflow drafts"), true);
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(validDefinition) }] } }] }) };
    }
  });
  assert.deepEqual(result.definition, validDefinition);
  assert.equal(result.saved, false);
  assert.equal(result.executed, false);
});
test("selects Gemini when configured and supports explicitly selecting OpenAI when both keys exist", () => {
  assert.equal(getProviderConfig({ GEMINI_API_KEY: "gemini-key" }).provider, "gemini");
  assert.equal(getProviderConfig({ GEMINI_API_KEY: "gemini-key", OPENAI_API_KEY: "openai-key" }).provider, "gemini");
  assert.equal(getProviderConfig({ AIVANTA_AI_PROVIDER: "openai", GEMINI_API_KEY: "gemini-key", OPENAI_API_KEY: "openai-key" }).provider, "openai");
  assert.equal(getProviderConfig({ AIVANTA_AI_PROVIDER: "gemini", AIVANTA_AI_API_KEY: "generic-key" }).apiKey, "generic-key");
  assert.throws(() => getProviderConfig({ AIVANTA_AI_PROVIDER: "anthropic", GEMINI_API_KEY: "key" }), /AI_CONFIGURATION_ERROR/);
});
test("classifies provider authorization, throttling, and generic errors safely", async () => {
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env, fetchImpl: fakeFetch({}, 401) }), /AI_PROVIDER_AUTH_ERROR/);
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env, fetchImpl: fakeFetch({}, 403) }), /AI_PROVIDER_AUTH_ERROR/);
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env, fetchImpl: fakeFetch({}, 429) }), /AI_RATE_LIMITED/);
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env, fetchImpl: fakeFetch({}, 500) }), /AI_PROVIDER_ERROR/);
});
test("classifies Gemini invalid API keys and rate limits", async () => {
  const geminiEnv = { AIVANTA_AI_PROVIDER: "gemini", GEMINI_API_KEY: "bad-key" };
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env: geminiEnv, fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ error: { message: "API key not valid. Please pass a valid API key." } }) }) }), /AI_PROVIDER_AUTH_ERROR/);
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env: geminiEnv, fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({ error: { message: "quota exceeded" } }) }) }), /AI_RATE_LIMITED/);
});
test("rejects invalid workflow structures returned by the model", async () => {
  await assert.rejects(generateWorkflow({ prompt: "Send all customer secrets", env, fetchImpl: fakeFetch({ choices: [{ message: { content: JSON.stringify({ version: 1, nodes: [{ id: "x", type: "action", title: "Unsafe", description: "", settings: { provider: "unknown" } }] }) } }] }) }), /AI_UNSAFE_WORKFLOW/);
});
test("rejects malformed provider payloads and empty model output", async () => {
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env, fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error("invalid JSON"); } }) }), /AI_INVALID_RESPONSE/);
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env, fetchImpl: fakeFetch({ choices: [] }) }), /AI_EMPTY_RESPONSE/);
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env, fetchImpl: fakeFetch({ choices: [{ message: { content: "not JSON" } }] }) }), /AI_INVALID_JSON/);
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env: { ...env, AIVANTA_AI_MODEL: "invalid model!" } }), /AI_CONFIGURATION_ERROR/);
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env: { ...env, AIVANTA_AI_BASE_URL: "http://ai.example.test", NODE_ENV: "production" } }), /AI_CONFIGURATION_ERROR/);
});
test("classifies provider transport failures and timeouts", async () => {
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env, fetchImpl: async () => { throw new Error("offline"); } }), /AI_PROVIDER_UNAVAILABLE/);
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env, fetchImpl: async () => { const error = new Error("timeout"); error.name = "AbortError"; throw error; } }), /AI_TIMEOUT/);
});
