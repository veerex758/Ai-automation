import { test } from "node:test";
import assert from "node:assert/strict";
import { nodes, findOperation } from "../nodes/registry";
import { executeRegisteredOperation } from "../nodes/runner";

test("registry includes versioned webhook, OpenAI, Slack, Email, Logic, Data, HTTP and Utilities operations", () => {
  assert.equal(nodes.length, 9);
  assert.ok(findOperation("manual", "start", "trigger"));
  assert.ok(findOperation("webhooks", "receive_event", "trigger"));
  assert.ok(findOperation("openai", "generate_text", "action"));
  assert.ok(findOperation("slack", "send_message", "action"));
  assert.ok(findOperation("email", "send_email", "action"));
  assert.ok(findOperation("logic", "condition", "action"));
  assert.ok(findOperation("logic", "filter_items", "action"));
  assert.ok(findOperation("data", "map_fields", "action"));
  assert.ok(findOperation("data", "format_text", "action"));
});

test("manual trigger accepts the legacy builder's manual start event", async () => {
  const operation = findOperation("manual", "start", "trigger");
  assert.ok(operation);
  const result = await operation.run({
    credentials: {}, logger: { info() {}, error() {} },
    http: { async request() { throw new Error("unexpected"); } }, previousOutputs: {},
  }, {});
  assert.deepEqual(result, { started: true });
});

test("webhook trigger refuses events not verified by ingress", async () => {
  const operation = findOperation("webhooks", "receive_event", "trigger");
  assert.ok(operation);
  await assert.rejects(() => operation.run({
    credentials: {}, logger: { info() {}, error() {} }, http: { async request() { throw new Error("unexpected"); } },
    previousOutputs: {},
  }, { eventId: "evt_1", eventType: "signup", receivedAt: new Date().toISOString(), payload: { email: "a@example.com" } }), /WEBHOOK_SIGNATURE_NOT_VERIFIED/);
});

test("registry runner resolves an operation by node and operation IDs", async () => {
  const result = await executeRegisteredOperation({
    nodeId: "webhooks", operationId: "receive_event", kind: "trigger",
    context: { credentials: {}, logger: { info() {}, error() {} }, http: { async request() { throw new Error("unexpected"); } }, previousOutputs: {}, webhook: { verified: true } },
    input: { eventId: "evt_1", eventType: "signup", receivedAt: new Date().toISOString(), payload: { email: "a@example.com" } },
  });
  assert.equal((result as { eventType: string }).eventType, "signup");
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
  assert.equal((result as { text: string }).text, "Hello from provider");
  assert.equal((result as { outputTokens?: number }).outputTokens, 4);
});

test("Slack action restricts configured webhook hosts and sends the message", async () => {
  const operation = findOperation("slack", "send_message", "action");
  assert.ok(operation);
  let requestedUrl = "";
  const result = await operation.run({
    credentials: { slack: { webhookUrl: "https://hooks.slack.com/services/T000/B000/secret" } },
    logger: { info() {}, error() {} },
    http: { async request(args) { requestedUrl = args.url; return { status: 200, body: "ok" }; } },
    previousOutputs: {},
  }, { message: "Test message" });
  assert.equal(requestedUrl, "https://hooks.slack.com/services/T000/B000/secret");
  assert.equal((result as { accepted: boolean }).accepted, true);
  await assert.rejects(() => operation.run({
    credentials: { slack: { webhookUrl: "https://example.com/webhook" } },
    logger: { info() {}, error() {} }, http: { async request() { throw new Error("unexpected"); } }, previousOutputs: {},
  }, { message: "Test message" }), /SLACK_CONNECTION_INVALID/);
});

test("Email action sends through Resend and returns provider message ID", async () => {
  const operation = findOperation("email", "send_email", "action");
  assert.ok(operation);
  let requestedUrl = "";
  const result = await operation.run({
    credentials: { resend: { apiKey: "test-only-key", fromEmail: "test@example.com" } },
    logger: { info() {}, error() {} },
    http: { async request(args) { requestedUrl = args.url; return { status: 200, body: { id: "email_test_123" } }; } },
    previousOutputs: {},
  }, { to: "recipient@example.com", subject: "Test", text: "Test message" });
  assert.equal(requestedUrl, "https://api.resend.com/emails");
  assert.equal((result as { messageId: string }).messageId, "email_test_123");
});

test("Logic condition compares values without external side effects", async () => {
  const operation = findOperation("logic", "condition", "action");
  assert.ok(operation);
  const result = await operation.run({
    credentials: {}, logger: { info() {}, error() {} },
    http: { async request() { throw new Error("unexpected"); } }, previousOutputs: {},
  }, { left: 12, operator: "greater_than", right: 8 });
  assert.deepEqual(result, { result: true });
});

test("Logic filter supports nested fields and preserves matching records", async () => {
  const operation = findOperation("logic", "filter_items", "action");
  assert.ok(operation);
  const result = await operation.run({
    credentials: {}, logger: { info() {}, error() {} },
    http: { async request() { throw new Error("unexpected"); } }, previousOutputs: {},
  }, { items: [{ customer: { active: true } }, { customer: { active: false } }], field: "customer.active", operator: "equals", value: true });
  assert.deepEqual(result, { items: [{ customer: { active: true } }], count: 1 });
});

test("Data mapping and text formatting support nested values", async () => {
  const context = {
    credentials: {}, logger: { info() {}, error() {} },
    http: { async request() { throw new Error("unexpected"); } }, previousOutputs: {},
  };
  const mapper = findOperation("data", "map_fields", "action");
  assert.ok(mapper);
  assert.deepEqual(await mapper.run(context, {
    data: { customer: { name: "Ada" }, id: 7 },
    fields: { fullName: "customer.name", customerId: "id", missing: "customer.email" },
  }), { data: { fullName: "Ada", customerId: 7, missing: null } });
  const formatter = findOperation("data", "format_text", "action");
  assert.ok(formatter);
  assert.deepEqual(await formatter.run(context, {
    template: "Hello {{customer.name}} (#{{id}})",
    data: { customer: { name: "Ada" }, id: 7 },
  }), { text: "Hello Ada (#7)" });
});


test("registry exposes secured HTTP and Utilities operations", () => {
  assert.equal(nodes.length, 9);
  assert.ok(findOperation("http", "request", "action"));
  assert.ok(findOperation("utilities", "parse_json", "action"));
  assert.ok(findOperation("utilities", "stringify_json", "action"));
  assert.ok(findOperation("utilities", "pick_fields", "action"));
});

test("HTTP request requires exact server-side host allowlist and restricts headers", async () => {
  const operation = findOperation("http", "request", "action");
  assert.ok(operation);
  let requestedUrl = "";
  const context = {
    credentials: { http: { allowedHosts: "api.example.com", apiKey: "server-only-test-key" } },
    logger: { info() {}, error() {} },
    http: { async request(args: { url: string; method: "GET" | "POST"; headers?: Record<string, string> }) {
      requestedUrl = args.url;
      assert.equal(args.headers?.authorization, "Bearer server-only-test-key");
      return { status: 200, body: { ok: true } };
    } },
    previousOutputs: {},
  };
  const result = await operation.run(context, {
    url: "https://api.example.com/v1/items",
    method: "GET",
    query: { q: "hello world" },
    auth: "bearer",
    headers: { accept: "application/json" },
  });
  assert.equal(requestedUrl, "https://api.example.com/v1/items?q=hello+world");
  assert.deepEqual(result, { status: 200, body: { ok: true } });
  await assert.rejects(() => operation.run(context, { url: "https://example.org/", method: "GET" }), /HTTP_HOST_NOT_ALLOWLISTED/);
  await assert.rejects(() => operation.run(context, { url: "http://api.example.com/", method: "GET" }), /HTTP_URL_NOT_ALLOWED/);
  await assert.rejects(() => operation.run(context, { url: "https://127.0.0.1/", method: "GET" }), /HTTP_HOST_NOT_ALLOWED/);
  await assert.rejects(() => operation.run(context, { url: "https://api.example.com/", method: "GET", headers: { authorization: "attacker-value" } }), /HTTP_HEADER_NOT_ALLOWED/);
});

test("HTTP request rejects oversized JSON bodies and GET bodies", async () => {
  const operation = findOperation("http", "request", "action");
  assert.ok(operation);
  const context = {
    credentials: { http: { allowedHosts: "api.example.com" } },
    logger: { info() {}, error() {} },
    http: { async request() { throw new Error("unexpected"); } },
    previousOutputs: {},
  };
  await assert.rejects(() => operation.run(context, { url: "https://api.example.com/", method: "GET", body: { no: "body" } }), /HTTP_GET_BODY_NOT_ALLOWED/);
  await assert.rejects(() => operation.run(context, { url: "https://api.example.com/", method: "POST", body: { data: "x".repeat(33000) } }), /HTTP_BODY_TOO_LARGE/);
});

test("Utilities parse, stringify and pick fields with explicit bounds", async () => {
  const context = {
    credentials: {}, logger: { info() {}, error() {} },
    http: { async request() { throw new Error("unexpected"); } }, previousOutputs: {},
  };
  const parse = findOperation("utilities", "parse_json", "action");
  const stringify = findOperation("utilities", "stringify_json", "action");
  const pick = findOperation("utilities", "pick_fields", "action");
  assert.ok(parse && stringify && pick);
  assert.deepEqual(await parse.run(context, { text: "{\"ok\":true}" }), { value: { ok: true } });
  await assert.rejects(() => parse.run(context, { text: "{" }), /JSON_PARSE_FAILED/);
  assert.deepEqual(await stringify.run(context, { value: { ok: true }, pretty: false }), { text: "{\"ok\":true}" });
  assert.deepEqual(await pick.run(context, { data: { a: 1, b: 2 }, fields: ["b", "missing"] }), { data: { b: 2 }, missing: ["missing"] });
});
