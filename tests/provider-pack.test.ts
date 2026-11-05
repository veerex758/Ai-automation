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
