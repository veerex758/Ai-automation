import { test } from "node:test";
import assert from "node:assert/strict";
import { httpNode } from "../nodes/http";
import type { NodeContext } from "../nodes/types";

function makeContext(response: { status: number; body: unknown } = { status: 200, body: { id: "lead-123" } }) {
  const calls: Array<{ url: string; method: string; headers?: Record<string, string>; body?: unknown; timeoutMs?: number; retries?: number }> = [];
  const context: NodeContext = {
    credentials: { http: { allowedHosts: "api.example.com", apiKeys: JSON.stringify({ "api.example.com": "secret-test-key" }) } },
    previousOutputs: { trigger: { email: "ada@example.com", count: 3, message: "Hello" } },
    logger: { info() {}, error() {} },
    http: { async request(args) { calls.push(args); return response; } },
  };
  return { context, calls };
}

const operation = httpNode.actions.find((item) => item.id === "request");
if (!operation) throw new Error("HTTP request node operation is missing");

test("HTTP node resolves $json variables in URL, query, headers, and JSON body", async () => {
  const { context, calls } = makeContext();
  const result = await operation.run(context, {
    url: "https://api.example.com/leads/{{ $json.email }}",
    method: "POST",
    query: { source: "{{ $json.message }}" },
    headers: { "x-customer-email": "{{ $json.email }}" },
    body: '{"email":"{{ $json.email }}","count":{{ $json.count }}}',
    auth: "bearer",
    timeoutMs: 5000,
    retries: 1,
  });
  assert.deepEqual(result, { status: 200, ok: true, data: { id: "lead-123" }, body: { id: "lead-123" } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.example.com/leads/ada@example.com?source=Hello");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].headers?.["x-customer-email"], "ada@example.com");
  assert.equal(calls[0].headers?.authorization, "Bearer secret-test-key");
  assert.deepEqual(calls[0].body, { email: "ada@example.com", count: 3 });
});

test("HTTP node rejects non-allowlisted hosts before making a request", async () => {
  const { context, calls } = makeContext();
  await assert.rejects(
    operation.run(context, { url: "https://other.example.com/data", method: "GET" }),
    /HTTP_HOST_NOT_ALLOWLISTED/,
  );
  assert.equal(calls.length, 0);
});

test("HTTP node blocks unsafe headers and refuses a body on GET", async () => {
  const { context, calls } = makeContext();
  await assert.rejects(
    operation.run(context, { url: "https://api.example.com/data", method: "GET", headers: { Host: "localhost" } }),
    /HTTP_HEADER_NOT_ALLOWED/,
  );
  await assert.rejects(
    operation.run(context, { url: "https://api.example.com/data", method: "GET", body: '{"x":1}' }),
    /HTTP_GET_BODY_NOT_ALLOWED/,
  );
  assert.equal(calls.length, 0);
});

test("continueOnError returns the HTTP response without misrepresenting its ok flag", async () => {
  const { context, calls } = makeContext({ status: 429, body: { error: "rate limited" } });
  const result = await operation.run(context, {
    url: "https://api.example.com/data",
    method: "GET",
    continueOnError: true,
  });
  assert.deepEqual(result, { status: 429, ok: false, data: { error: "rate limited" }, body: { error: "rate limited" } });
  assert.equal(calls.length, 1);
});
