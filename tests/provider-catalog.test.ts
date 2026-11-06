import test from "node:test";
import assert from "node:assert/strict";
import { getExecutableNodeCatalog, getPublicNodeCatalog, nodes } from "../nodes/registry";
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
  assert.equal(registered.length, 100);
  assert.equal(comingSoon.length, 100 - registered.length);
  assert.ok(comingSoon.every((node) => node.triggers.length === 0 && node.actions.length === 0));
});

test("AI workflow generation receives only registered, schema-backed operations", () => {
  const catalog = getExecutableNodeCatalog();
  assert.equal(catalog.length, nodes.length);
  assert.ok(catalog.every((node) => node.executionStatus === "registered"));
  assert.deepEqual(new Set(catalog.map((node) => node.id)), new Set(nodes.filter((node) => catalog.some((entry) => entry.id === node.id)).map((¶»§q«^