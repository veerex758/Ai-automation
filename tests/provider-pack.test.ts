/* eslint-disable @typescript-eslint/no-explicit-any */
import test from "node:test";
import assert from "node:assert/strict";
import { providerPack } from "../nodes/provider-pack";
import { findOperation } from "../nodes/registry";

test("20 additional catalogue providers have executable schema-backed actions", () => {
  assert.equal(providerPack.length, 20);
  for (const node of providerPack) {
    assert.equal(node.actions.length, 1, node.id);
    const action = node.actions[0];
    assert.ok(action.id);
    assert.ok(action.inputSchema);
    assert.ok(action.outputSchema);
    assert.equal(typeof action.run, "function");
  }
});

test("provider adapters fail closed when workspace credentials are absent", async () => {
  const context = {
    credentials: {}, logger: { info() {}, error() {} },
    http: { async request() { throw new Error("network must not be reached"); } },
    previousOutputs: {},
  };
  const node = findOperation("claude", "execute", "action");
  assert.ok(node);
  await assert.rejects(() => node.run(context, { prompt: "hello" }), /CLAUDE_CONNECTION_REQUIRED/);
});

test("Claude adapter uses fixed vendor endpoint and validates returned text", async () => {
  let called: any;
  const context = {
    credentials: { claude: { apiKey: "test-token" } },
    logger: { info() {}, error() {} },
    http: { async request(args: any) {
      called = args;
      return { status: 200, body: { model: "claude-test", content: [{ type: "text", text: "Hello from Claude" }] } };
    } },
    previousOutputs: {},
  };
  const operation = findOperation("claude", "execute", "action");
  assert.ok(operation);
  const result = await operation.run(context, { prompt: "hello" });
  assert.deepEqual(result, { text: "Hello from Claude", model: "claude-test" });
  assert.equal(called.url, "https://api.anthropic.com/v1/messages");
  assert.equal(called.headers["x-api-key"], "test-token");
});

test("RSS node is credential-free and still relies on the guarded HTTP client", async () => {
  let called = false;
  const context = {
    credentials: {}, logger: { info() {}, error() {} },
    http: { async request(args: any) {
      called = true;
      assert.equal(args.method, "GET");
      return { status: 200, body: "<rss><channel/></rss>" };
    } },
    previousOutputs: {},
  };
  const operation = findOperation("rss_feed", "execute", "action");
  assert.ok(operation);
  const result = await operation.run(context, { feedUrl: "https://feeds.example.test/rss" });
  assert.equal((result as any).xml, "<rss><channel/></rss>");
  assert.equal(called, true);
});


test("Sentry adapter accepts the provider's top-level projects array", async () => {
  let requested = "";
  const context = {
    credentials: { sentry: { authToken: "sentry-test-token" } },
    logger: { info() {}, error() {} },
    http: { async request(args: any) {
      requested = args.url;
      return { status: 200, body: [{ id: "42", name: "Aivanta", slug: "aivanta" }] };
    } },
    previousOutputs: {},
  };
  const operation = findOperation("sentry", "execute", "action");
  assert.ok(operation);
  const result = await operation.run(context, { organization: "acme" });
  assert.match(requested, /organizations\/acme\/projects/);
  assert.deepEqual(result, { projects: [{ id: "42", name: "Aivanta", slug: "aivanta" }] });
});

test("provider auth metadata names the actual saved secret and RSS needs no credential", () => {
  const byId = new Map(providerPack.map((node) => [node.id, node]));
  assert.equal(byId.get("discord")?.auth.type, "apiKey");
  assert.equal((byId.get("discord")?.auth as any).credentialKey, "botToken");
  assert.equal((byId.get("whatsapp_business")?.auth as any).credentialKey, "accessToken");
  assert.equal(byId.get("rss_feed")?.auth.type, "none");
});


test("four catalogue AI providers are registered with schema-backed actions", () => {
  const ids = ["elevenlabs", "stability_ai", "hugging_face", "pinecone"];
  for (const id of ids) {
    const operation = findOperation(id, "execute", "action");
    assert.ok(operation, id);
    assert.ok(operation.inputSchema.toJSONSchema());
    assert.ok(operation.outputSchema.toJSONSchema());
  }
});

test("ElevenLabs lists bounded voice metadata using the saved API key", async () => {
  let request: any;
  const operation = findOperation("elevenlabs", "execute", "action");
  assert.ok(operation);
  const result = await operation.run({
    credentials: { elevenlabs: { apiKey: "eleven-test" } },
    logger: { info() {}, error() {} },
    http: { async request(args: any) { request = args; return { status: 200, body: { voices: [{ voice_id: "voice-1", name: "Test Voice", category: "premade" }] } }; } },
    previousOutputs: {},
  }, { pageSize: 10 });
  assert.deepEqual(result, { voices: [{ voiceId: "voice-1", name: "Test Voice", category: "premade" }] });
  assert.equal(request.headers["xi-api-key"], "eleven-test");
});

test("Stability AI accepts the provider's engine-list array response", async () => {
  const operation = findOperation("stability_ai", "execute", "action");
  assert.ok(operation);
  const result = await operation.run({
    credentials: { stability_ai: { apiKey: "stability-test" } },
    logger: { info() {}, error() {} },
    http: { async request() { return { status: 200, body: [{ id: "stable-image-core", name: "Stable Image Core", type: "PICTURE" }] }; } },
    previousOutputs: {},
  }, {});
  assert.deepEqual(result, { models: [{ id: "stable-image-core", name: "Stable Image Core", type: "PICTURE" }] });
});

test("Hugging Face validates model identifiers and extracts generated text", async () => {
  const operation = findOperation("hugging_face", "execute", "action");
  assert.ok(operation);
  const result = await operation.run({
    credentials: { hugging_face: { apiKey: "hf-test" } },
    logger: { info() {}, error() {} },
    http: { async request(args: any) {
      assert.match(args.url, /models\/org\/model/);
      assert.equal(args.headers.Authorization, "Bearer hf-test");
      return { status: 200, body: [{ generated_text: "Generated safely" }] };
    } },
    previousOutputs: {},
  }, { model: "org/model", inputs: "Write a greeting", maxNewTokens: 32 });
  assert.deepEqual(result, { generatedText: "Generated safely" });
});

test("Pinecone requires a Pinecone HTTPS index host and returns validated matches", async () => {
  const operation = findOperation("pinecone", "execute", "action");
  assert.ok(operation);
  const context = {
    credentials: { pinecone: { apiKey: "pc-test", indexHost: "https://aivanta-test.svc.us-east1-gcp.pinecone.io" } },
    logger: { info() {}, error() {} },
    http: { async request(args: any) {
      assert.equal(args.url, "https://aivanta-test.svc.us-east1-gcp.pinecone.io/query");
      return { status: 200, body: { matches: [{ id: "vector-1", score: 0.98, metadata: { kind: "lead" } }] } };
    } },
    previousOutputs: {},
  };
  const result = await operation.run(context, { vector: [0.1, 0.2], topK: 5 });
  assert.deepEqual(result, { matches: [{ id: "vector-1", score: 0.98, metadata: { kind: "lead" } }] });
  await assert.rejects(() => operation.run({ ...context, credentials: { pinecone: { apiKey: "pc-test", indexHost: "https://example.com" } } }, { vector: [1] }), /PINECONE_CONNECTION_INVALID/);
});
