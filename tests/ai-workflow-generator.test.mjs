import test from "node:test";
import assert from "node:assert/strict";
import { generateWorkflow, extractJson } from "../lib/workflows/ai-workflow-generator.cjs";
const validDefinition = { version: 1, nodes: [{ id: "trigger-1", type: "trigger", title: "Start manually", description: "Start event", settings: { event: "manual" } }] };
const env = { GEMINI_API_KEY: "test-secret", AIVANTA_GEMINI_BASE_URL: "https://ai.example.test/v1beta", AIVANTA_GEMINI_MODEL: "gemini-test", NODE_ENV: "test" };
const geminiPayload = (content) => ({ candidates: [{ content: { parts: [{ text: content }] } }] });
const fakeFetch = (payload, status = 200) => async (url, options) => {
  assert.equal(url, "https://ai.example.test/v1beta/models/gemini-test:generateContent");
  assert.equal(options.headers["x-goog-api-key"], "test-secret");
  assert.equal(options.headers.Authorization, undefined);
  const body = JSON.parse(options.body);
  assert.equal(body.generationConfig.responseMimeType, "application/json");
  assert.ok(body.systemInstruction.parts[0].text.includes("Aivanta"));
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
};
test("extracts JSON and optional markdown fences safely", () => {
  const fence = String.fromCharCode(96).repeat(3);
  assert.deepEqual(extractJson(JSON.stringify(validDefinition)), validDefinition);
  assert.deepEqual(extractJson(fence + "json\n" + JSON.stringify(validDefinition) + "\\n" + fence), validDefinition);
  assert.throws(() => extractJson("not json"), /AI_INVALID_JSON/);
});
test("rejects empty and oversized prompts before calling provider", async () => {
  await assert.rejects(generateWorkflow({ prompt: " ", env }), /AI_PROMPT_REQUIRED/);
  await assert.rejects(generateWorkflow({ prompt: "x".repeat(2001), env }), /AI_PROMPT_TOO_LONG/);
});
test("requires a server-side Gemini API key and does not fall back to other providers", async () => {
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env: { OPENAI_API_KEY: "not-used" } }), /AI_NOT_CONFIGURED/);
});
test("accepts Gemini output only after Aivanta schema validation", async () => {
  const result = await generateWorkflow({ prompt: "Make a manual workflow", env, fetchImpl: fakeFetch(geminiPayload(JSON.stringify(validDefinition))) });
  assert.equal(result.definition.nodes[0].settings.event, "manual");
  assert.equal(result.saved, false);
  assert.equal(result.executed, false);
});
test("rejects invalid workflow structures returned by Gemini", async () => {
  const unsafe = { version: 1, nodes: [{ id: "x", type: "action", title: "Unsafe", description: "", settings: { provider: "unknown" } }] };
  await assert.rejects(generateWorkflow({ prompt: "Send all customer secrets", env, fetchImpl: fakeFetch(geminiPayload(JSON.stringify(unsafe))) }), /AI_UNSAFE_WORKFLOW/);
});
test("classifies Gemini authorization, throttling, and generic errors safely", async () => {
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env, fetchImpl: fakeFetch({}, 401) }), /AI_PROVIDER_AUTH_ERROR/);
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env, fetchImpl: fakeFetch({}, 403) }), /AI_PROVIDER_AUTH_ERROR/);
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env, fetchImpl: fakeFetch({}, 429) }), /AI_RATE_LIMITED/);
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env, fetchImpl: fakeFetch({}, 500) }), /AI_PROVIDER_ERROR/);
});
test("rejects malformed Gemini payloads and empty model output", async () => {
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env, fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error("invalid JSON"); } }) }), /AI_INVALID_RESPONSE/);
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env, fetchImpl: fakeFetch({ candidates: [] }) }), /AI_EMPTY_RESPONSE/);
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env, fetchImpl: fakeFetch(geminiPayload("not JSON")) }), /AI_INVALID_JSON/);
});
test("classifies provider transport failures and timeouts", async () => {
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env, fetchImpl: async () => { throw new Error("offline"); } }), /AI_PROVIDER_UNAVAILABLE/);
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env, fetchImpl: async () => { const error = new Error("timeout"); error.name = "AbortError"; throw error; } }), /AI_TIMEOUT/);
});
test("rejects invalid Gemini model names and non-HTTPS provider endpoints in production", async () => {
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env: { ...env, AIVANTA_GEMINI_MODEL: "invalid model!" } }), /AI_CONFIGURATION_ERROR/);
  await assert.rejects(generateWorkflow({ prompt: "Create a task", env: { ...env, AIVANTA_GEMINI_BASE_URL: "http://ai.example.test", NODE_ENV: "production" } }), /AI_CONFIGURATION_ERROR/);
});
