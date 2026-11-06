import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { validateDefinition } = require("../lib/workflows/validate-definition.cjs");

const node = (id, type = "action", settings = {}) => ({
  id, type, title: id, description: "", settings,
});
const trigger = node("start", "trigger", { event: "manual" });

test("upgrades a legacy linear definition into explicit next edges", () => {
  const result = validateDefinition({
    version: 1,
    nodes: [trigger, node("one"), node("two")],
  });
  assert.ok(result.definition);
  assert.deepEqual(result.definition.edges, [
    { id: "edge-1", source: "start", target: "one", sourceHandle: "next" },
    { id: "edge-2", source: "one", target: "two", sourceHandle: "next" },
  ]);
});

test("accepts a condition with distinct true and false paths", () => {
  const result = validateDefinition({
    version: 1,
    nodes: [
      trigger,
      node("check", "condition", { field: "status", operator: "equals", value: "qualified" }),
      node("yes"),
      node("no"),
    ],
    edges: [
      { id: "e1", source: "start", target: "check", sourceHandle: "next" },
      { id: "e2", source: "check", target: "yes", sourceHandle: "true" },
      { id: "e3", source: "check", target: "no", sourceHandle: "false" },
    ],
  });
  assert.ok(result.definition);
  assert.equal(result.definition.edges.length, 3);
});

test("rejects a condition missing one branch", () => {
  const result = validateDefinition({
    version: 1,
    nodes: [trigger, node("check", "condition", { field: "status", operator: "equals", value: "qualified" }), node("yes")],
    edges: [
      { id: "e1", source: "start", target: "check", sourceHandle: "next" },
      { id: "e2", source: "check", target: "yes", sourceHandle: "true" },
    ],
  });
  assert.match(result.error, /both a true and a false branch/);
});

test("rejects cycles and unreachable nodes", () => {
  const cyclic = validateDefinition({
    version: 1,
    nodes: [trigger, node("one"), node("two")],
    edges: [
      { id: "e1", source: "start", target: "one" },
      { id: "e2", source: "one", target: "two" },
      { id: "e3", source: "two", target: "one" },
    ],
  });
  assert.match(cyclic.error, /cannot contain a cycle/);

  const unreachable = validateDefinition({
    version: 1,
    nodes: [trigger, node("one"), node("orphan")],
    edges: [{ id: "e1", source: "start", target: "one" }],
  });
  assert.match(unreachable.error, /reachable from the trigger/);
});

test("rejects duplicate output handles and unknown edge endpoints", () => {
  const duplicate = validateDefinition({
    version: 1,
    nodes: [trigger, node("one"), node("two")],
    edges: [
      { id: "e1", source: "start", target: "one" },
      { id: "e2", source: "start", target: "two" },
    ],
  });
  assert.match(duplicate.error, /one connection for each output path/);

  const unknown = validateDefinition({
    version: 1,
    nodes: [trigger],
    edges: [{ id: "e1", source: "start", target: "missing" }],
  });
  assert.match(unknown.error, /valid, different source and target/);
});
