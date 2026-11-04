import test from "node:test";
import assert from "node:assert/strict";
import { getPublicNodeCatalog, nodes } from "../nodes/registry";
import { executeRegisteredOperation } from "../nodes/runner";

test("the integrations directory contains all 100 requested providers exactly once", () => {
  const catalog = getPublicNodeCatalog();
  assert.equal(catalog.length, 100);
  assert.equal(new Set(catalog.map((node) => node.id)).size, 100);
  assert.ok(catalog.some((node) => node.name === "OpenWeather"));
  assert.ok(catalog.some((node) => node.name === "Twilio Voice"));
});

test("only native registry implementations are marked as registered", () => {
  const catalog = getPublicNodeCatalog();
  const registered = catalog.filter((node) => node.executionStatus === "registered");
  const comingSoon = catalog.filter((node) => node.executionStatus === "coming_soon");
  assert.equal(registered.length, nodes.length);
  assert.equal(registered.length, 19);
  assert.equal(comingSoon.length, 100 - nodes.length);
  assert.ok(comingSoon.every((node) => node.triggers.length === 0 && node.actions.length === 0));
});

test("the AI execution registry exposes schema-backed handlers only", () => {
  const catalog = getPublicNodeCatalog();
  for (const item of catalog.filter((node) => node.executionStatus === "registered")) {
    assert.ok(item.triggers.every((operation) => operation.inputSchema && operation.outputSchema));
    assert.ok(item.actions.every((operation) => operation.inputSchema && operation.outputSchema));
  }
});

const context = {
  credentials: {},
  logger: { info() {}, error() {} },
  http: { async request() { throw new Error("Network access is not expected in data utility tests."); } },
  previousOutputs: {},
};

test("Set Fields creates a new object and safely rejects prototype keys", async () => {
  const result = await executeRegisteredOperation({
    nodeId: "set_fields", operationId: "merge_fields", kind: "action", context,
    input: { data: { name: "Ada", role: "reader" }, fields: { role: "admin", active: true } },
  });
  assert.deepEqual(result, { data: { name: "Ada", role: "admin", active: true } });
  await assert.rejects(() => executeRegisteredOperation({
    nodeId: "set_fields", operationId: "merge_fields", kind: "action", context,
    input: { data: {}, fields: JSON.parse('{"__proto__":{"polluted":true}}') },
  }), /SET_FIELDS_INVALID_KEY/);
});

test("JSON Parse safely resolves a nested path", async () => {
  const result = await executeRegisteredOperation({
    nodeId: "json_parse", operationId: "parse", kind: "action", context,
    input: { json: '{"lead":{"email":"ada@example.com"}}', path: ["lead", "email"] },
  });
  assert.deepEqual(result, { value: "ada@example.com", compactJson: '"ada@example.com"' });
  await assert.rejects(() => executeRegisteredOperation({
    nodeId: "json_parse", operationId: "parse", kind: "action", context,
    input: { json: '{"__proto__":{"polluted":true}}' },
  }), /JSON_PARSE_UNSAFE_KEY/);
});

test("Filter and Aggregate apply bounded, typed calculations", async () => {
  const filtered = await executeRegisteredOperation({
    nodeId: "filter", operationId: "filter_items", kind: "action", context,
    input: { items: [{ score: 2 }, { score: 9 }, { score: 12 }], path: ["score"], operator: "gte", value: 9 },
  });
  assert.deepEqual(filtered, { items: [{ score: 9 }, { score: 12 }], count: 2 });
  const aggregate = await executeRegisteredOperation({
    nodeId: "aggregate", operationId: "calculate", kind: "action", context,
    input: { items: [{ amount: 2 }, { amount: 8 }], path: ["amount"], operation: "average" },
  });
  assert.deepEqual(aggregate, { value: 5, count: 2 });
});
