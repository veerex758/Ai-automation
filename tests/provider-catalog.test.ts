import test from "node:test";
import assert from "node:assert/strict";
import { getPublicNodeCatalog, nodes } from "../nodes/registry";

test("the integrations directory contains all 100 requested providers exactly once", () => {
  const catalog = getPublicNodeCatalog();
  assert.equal(catalog.length, 100);
  assert.equal(new Set(catalog.map((node) => node.id)).size, 100);
  assert.ok(catalog.some((node) => node.name === "OpenWeather"));
  assert.ok(catalog.some((node) => node.name === "Twilio Voice"));
});

test("only native registry implementations are marked execution-ready", () => {
  const catalog = getPublicNodeCatalog();
  const ready = catalog.filter((node) => node.executionStatus === "available");
  const comingSoon = catalog.filter((node) => node.executionStatus === "coming_soon");
  assert.equal(ready.length, nodes.length);
  assert.equal(comingSoon.length, 100 - nodes.length);
  assert.ok(comingSoon.every((node) => node.triggers.length === 0 && node.actions.length === 0));
});

test("the AI execution registry remains limited to schema-backed handlers", () => {
  const catalog = getPublicNodeCatalog();
  for (const item of catalog.filter((node) => node.executionStatus === "available")) {
    assert.ok(item.triggers.every((operation) => operation.inputSchema && operation.outputSchema));
    assert.ok(item.actions.every((operation) => operation.inputSchema && operation.outputSchema));
  }
});
