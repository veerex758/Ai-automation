import { test } from "node:test";
import assert from "node:assert/strict";
import { nodes, findOperation } from "../nodes/registry";

test("registry includes versioned webhook trigger and OpenAI action", () => {
  assert.equal(nodes.length, 2);
  assert.ok(findOperation("webhooks", "receive_event", "trigger"));
  assert.ok(findOperation("openai", "generate_text", "action"));
});

test("webhook trigger refuses events not verified by ingress", async () => {
  const operation = findOperation("webhooks", "receive_event", "trigger");
  assert.ok(operation);
  await assert.rejects(() => operation.run({
    credentials: {}, logger: { info() {}, error() {} }, http: { async request() { throw new Error("unexpected"); } },
    previousOutputs: {},
  }, { eventId: "evt_1", eventType: "signup", receivedAt: new Date().toISOString(), payload: { email: "a@example.com" } }), /WEBHOOK_SIGNATURE_NOT_VERIFIED/);
});

test("OpenAI action makes a real Responses API request and validates actual output", async () => {
  const operation = findOperation("openai", "generate_text", "action");
  assert.ok(operation);
  let requestedUrl = "";
  const result = await operation.run({
    credentials: { openai: { apiKey: "test-only-key" } },
    logger: { info() {}, error() {} },
    http: { async request(args) { requestedUrl = args.url; return { status: 200, body: { output_text: "Hello from provider", model: "gpt-4o-mini", usage: { input_tokens: 2, output_tokens: 4 } } }; } },
    previousOutputs: {},
  }, { prompt: "Say hello", model: "gpt-4o-mini", maxOutputTokens: 50 });
  assert.equal(requestedUrl, "https://api.openai.com/v1/responses");
  assert.equal(result.text, "Hello from provider");
  assert.equal(result.outputTokens, 4);
});
