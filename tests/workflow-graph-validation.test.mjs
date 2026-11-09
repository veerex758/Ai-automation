import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { validateDefinition } = require("../lib/workflows/validate-definition.cjs");

const trigger = { id: "start", type: "trigger", title: "Start", description: "Start event", settings: { event: "manual" } };
const action = (id) => ({ id, type: "action", title: "Create task", description: "Internal task", settings: { provider: "internal", operation: "create_task", message: "Review this item" } });
const condition = { id: "check", type: "condition", title: "Check score", description: "Branch by score", settings: { field: "score", operator: "greater_than", value: "10" } };

test("legacy linear definitions receive deterministic next edges", () => {
  const result = validateDefinition({ version: 1, nodes: [trigger, action("a"), action("b")] });
  assert.ok(result.definition, result.error);
  assert.deepEqual(result.definition.edges.map(({ source, target, label }) => [source, target, label]), [
    ["start", "a", "next"], ["a", "b", "next"]
  ]);
});

test("accepts a connected condition with true and false branches", () => {
  const result = validateDefinition({
    version: 1,
    nodes: [trigger, condition, action("yes"), action("no")],
    edges: [
      { id: "start-check", source: "start", target: "check", label: "next" },
      { id: "check-yes", source: "check", target: "yes", label: "true" },
      { id: "chec¶»§q«^