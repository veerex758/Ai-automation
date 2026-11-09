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
      { id: "check-no", source: "check", target: "no", label: "false" }
    ]
  });
  assert.ok(result.definition, result.error);
  assert.equal(result.definition.edges.length, 3);
});

test("rejects a condition without both labelled branches", () => {
  const result = validateDefinition({
    version: 1, nodes: [trigger, condition, action("yes")],
    edges: [
      { id: "start-check", source: "start", target: "check" },
      { id: "check-yes", source: "check", target: "yes", label: "true" }
    ]
  });
  assert.equal(result.error, "A condition must have exactly one true and one false branch.");
});

test("rejects cycles, disconnected nodes, duplicate edges, and dangling endpoints", () => {
  const cycle = validateDefinition({
    version: 1, nodes: [trigger, action("a"), action("b")],
    edges: [
      { id: "one", source: "start", target: "a" },
      { id: "two", source: "a", target: "b" },
      { id: "three", source: "b", target: "a" }
    ]
  });
  assert.equal(cycle.error, "Workflow connections cannot contain a cycle.");
  const disconnected = validateDefinition({ version: 1, nodes: [trigger, action("a"), action("b")], edges: [{ id: "one", source: "start", target: "a" }] });
  assert.match(disconnected.error, /Every step must be connected/);
  const dangling = validateDefinition({ version: 1, nodes: [trigger, action("a")], edges: [{ id: "one", source: "start", target: "missing" }] });
  assert.match(dangling.error, /existing steps/);
});

test("rejects a true/false label on a non-condition node", () => {
  const result = validateDefinition({ version: 1, nodes: [trigger, action("a")], edges: [{ id: "one", source: "start", target: "a", label: "true" }] });
  assert.equal(result.error, "Only condition steps can have true or false branches.");
});

test("rejects condition nodes without both branches and non-condition fan-out", () => {
  const unbranchedCondition = validateDefinition({
    version: 1, nodes: [trigger, condition, action("yes")],
    edges: [{ id: "start-check", source: "start", target: "check" }, { id: "check-yes", source: "check", target: "yes", label: "true" }]
  });
  assert.equal(unbranchedCondition.error, "A condition must have exactly one true and one false branch.");

  const actionFanOut = validateDefinition({
    version: 1, nodes: [trigger, action("a"), action("b")],
    edges: [{ id: "one", source: "start", target: "a" }, { id: "two", source: "start", target: "b" }]
  });
  assert.equal(actionFanOut.error, "Only condition steps can have multiple outgoing connections.");
});
