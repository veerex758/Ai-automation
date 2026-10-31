import { test } from "node:test";
import assert from "node:assert/strict";
import { nodes, findOperation } from "../nodes/registry";
import { executeRegisteredOperation } from "../nodes/runner";
import { isUnsafeAddress } from "../lib/workflows/safe-http-transport";

test("registry includes versioned webhook, OpenAI, Slack, Email, Logic, Data, HTTP and Utilities operations", () => {
  assert.equal(nodes.length, 11);
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

test("If / Else executes only the selected branch and preserves typed references", async () => {
  const operation = findOperation("logic", "if_else", "action");
  assert.ok(operation);
  const context = {
    credentials: {}, logger: { info() {}, error() {} },
    http: { async request() { throw new Error("unexpected"); } },
    previousOutputs: { source: { customer: { name: "Ada" }, score: 9 } },
  };
  const result = operation.outputSchema.parse(await operation.run(context, {
    left: 9, operator: "greater_than", right: 5,
    thenSteps: [{
      id: "format", nodeId: "data", operationId: "format_text",
      input: { template: "Hello {{customer.name}}", data: "{{source}}" },
    }],
    elseSteps: [{
      id: "never", nodeId: "data", operationId: "format_text",
      input: { template: "Wrong branch", data: {} },
    }],
  }));
  assert.equal(result.result, true);
  assert.equal(result.branch, "then");
  assert.deepEqual(result.outputs.format, { text: "Hello Ada" });
  assert.equal("never" in result.outputs, false);
  await assert.rejects(() => operation.run(context, {
    left: true, operator: "equals", right: true,
    thenSteps: [{ id: "nested", nodeId: "logic", operationId: "if_else", input: { left: true, operator: "equals", right: true } }],
    elseSteps: [],
  }), /IF_ELSE_NESTING_NOT_SUPPORTED/);
});

test("Logic filter supports nested fields and preserves matching records", async () => {
  const operation = findOperation("logic", "filter_items", "action");
  assert.ok(operation);
  const result = await operation.run({
    credentials: {}, logger: { info() {}, error() {} },
    http: { async request() { throw new Error("unexpected"); } }, previousOutputs: {},
  }, { items: [{ customer: { active: true } }, { customer: { active: false } }], field: "customer.active", operator: "equals", value: true }) as { items: Array<{ customer: { active: boolean } }>; count: number };
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
  assert.equal(nodes.length, 11);
  assert.ok(findOperation("http", "request", "action"));
  assert.ok(findOperation("utilities", "parse_json", "action"));
  assert.ok(findOperation("utilities", "stringify_json", "action"));
  assert.ok(findOperation("utilities", "pick_fields", "action"));
  assert.ok(findOperation("date_time", "format_timestamp", "action"));
  assert.ok(findOperation("date_time", "compare_dates", "action"));
  assert.ok(findOperation("date_time", "calculate_duration", "action"));
  assert.ok(findOperation("loop", "for_each", "action"));
});

test("Data nodes deduplicate, sort, and aggregate without coercion", async () => {
  const context = {
    credentials: {}, logger: { info() {}, error() {} },
    http: { async request() { throw new Error("unexpected"); } }, previousOutputs: {},
  };
  const dedupe = findOperation("data", "deduplicate_items", "action");
  const sort = findOperation("data", "sort_items", "action");
  const aggregate = findOperation("data", "aggregate_numbers", "action");
  assert.ok(dedupe && sort && aggregate);
  assert.deepEqual(dedupe.outputSchema.parse(await dedupe.run(context, {
    items: [{ id: 1, name: "Ada" }, { id: 1, name: "Ada" }, { id: 2, name: "Lin" }],
    key: "id",
  })), { items: [{ id: 1, name: "Ada" }, { id: 2, name: "Lin" }], count: 2, removed: 1 });
  assert.deepEqual(sort.outputSchema.parse(await sort.run(context, {
    items: [{ score: 9 }, { score: 2 }, { score: 5 }], key: "score",
  })), { items: [{ score: 2 }, { score: 5 }, { score: 9 }], count: 3 });
  assert.deepEqual(aggregate.outputSchema.parse(await aggregate.run(context, { values: [2, 4, 6] })), {
    count: 3, sum: 12, average: 4, min: 2, max: 6,
  });
  await assert.rejects(() => aggregate.run(context, { values: [1, "2"] }), /expected number/i);
});

test("Data split_batches keeps every item in ordered batches", async () => {
  const operation = findOperation("data", "split_batches", "action");
  assert.ok(operation);
  const result = operation.outputSchema.parse(await operation.run({ credentials: {}, logger: { info() {}, error() {} }, http: { async request() { throw new Error("unexpected"); } }, previousOutputs: {} }, { items: [1, 2, 3, 4, 5], batchSize: 2 })) as { batches: number[][] };
  assert.deepEqual(result.batches, [[1, 2], [3, 4], [5]]);
});

test("HTTP request requires exact server-side host allowlist and restricts headers", async () => {
  const operation = findOperation("http", "request", "action");
  assert.ok(operation);
  let requestedUrl = "";
  const context = {
    credentials: { http: { allowedHosts: "api.example.com", apiKeys: JSON.stringify({ "api.example.com": "server-only-test-key" }) } },
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


test("Date & Time formats timestamps, compares dates, and calculates durations", async () => {
  const context = {
    credentials: {}, logger: { info() {}, error() {} },
    http: { async request() { throw new Error("unexpected"); } }, previousOutputs: {},
  };
  const format = findOperation("date_time", "format_timestamp", "action");
  const compare = findOperation("date_time", "compare_dates", "action");
  const duration = findOperation("date_time", "calculate_duration", "action");
  assert.ok(format && compare && duration);
  assert.equal(format.outputSchema.parse(await format.run(context, { timestamp: "2026-01-01T00:00:00.000Z", style: "iso" })).value as string, "2026-01-01T00:00:00.000Z");
  assert.deepEqual(compare.outputSchema.parse(await compare.run(context, { left: "2026-01-01T00:00:00Z", right: "2026-01-02T00:00:00Z" })), {
    comparison: "before", differenceMs: 86400000, differenceSeconds: 86400,
  });
  assert.deepEqual(duration.outputSchema.parse(await duration.run(context, { start: 0, end: 7200000, unit: "hours" })), {
    duration: 2, unit: "hours", milliseconds: 7200000,
  });
  await assert.rejects(() => format.run(context, { timestamp: "not-a-date", style: "iso" }), /DATETIME_INVALID_TIMESTAMP/);
});

test("Loop / Iterate executes bounded registered actions for each input record", async () => {
  const loop = findOperation("loop", "for_each", "action");
  assert.ok(loop);
  const context = {
    credentials: {}, logger: { info() {}, error() {} },
    http: { async request() { throw new Error("unexpected"); } }, previousOutputs: {},
  };
  const result = loop.outputSchema.parse(await loop.run(context, {
    items: [{ score: 3 }, { score: 8 }],
    steps: [{ id: "check", nodeId: "logic", operationId: "condition", input: {
      left: "{{item.score}}", operator: "greater_than", right: 5,
    } }],
  })) as { itemsProcessed: number; itemsSucceeded: number; itemsFailed: number; results: Array<{ outputs: Record<string, unknown> }> };
  assert.equal(result.itemsProcessed, 2);
  assert.equal(result.itemsSucceeded, 2);
  assert.equal((result.results[0].outputs.check as { result: boolean }).result, false);
  assert.equal((result.results[1].outputs.check as { result: boolean }).result, true);
  await assert.rejects(() => loop.run(context, {
    items: Array.from({ length: 101 }, (_, index) => index),
    steps: [{ id: "check", nodeId: "logic", operationId: "condition", input: { left: 1, operator: "equals", right: 1 } }],
  }), /Too big|maximum/i);
});


test("HTTP transport rejects private, loopback, link-local, reserved and mapped IPv6 addresses", () => {
  for (const address of [
    "127.0.0.1", "10.0.0.5", "172.16.0.1", "192.168.1.2", "169.254.169.254",
    "100.64.0.1", "198.18.0.1", "203.0.113.8", "224.0.0.1",
    "::", "::1", "fc00::1", "fd12::1", "fe80::1", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::7f00:1", "2002:7f00:1::1",
  ]) assert.equal(isUnsafeAddress(address), true, address);
  for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) {
    assert.equal(isUnsafeAddress(address), false, address);
  }
});
