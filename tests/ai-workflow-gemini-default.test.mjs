import test from "node:test";
import assert from "node:assert/strict";
import { generateWorkflow } from "../lib/workflows/ai-workflow-generator.cjs";

test("Gemini remains the default when both Gemini and OpenAI keys are configured", async () => {
  let url = "";
  let auth = "";
  await generateWorkflow({
    prompt: "Make a manual workflow",
    env: { GEMINI_API_KEY: "gemini-key", OPENAI_API_KEY: "openai-key", NODE_ENV: "test" },
    fetchImpl: async (requested, options) => {
      url = requested;
      auth = options.headers.Authorization;
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ version: 1, nodes: [{ id: "start", type: "trigger", title: "Start", description: "Manual start", settings: { event: "manual" } }], edges: [] }) } }] }) };
    },
  });
  assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
  assert.equal(auth, "Bearer gemini-key");
});
