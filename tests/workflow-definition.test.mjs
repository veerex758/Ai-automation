import test from "node:test";
import assert from "node:assert/strict";
import validator from "../lib/workflows/validate-definition.cjs";

const { validateDefinition } = validator;

const trigger = (settings = { event: "manual" }) => ({
  id: "trigger-1", type: "trigger", title: "Start workflow",
  description: "Start on an event.", settings,
});
const action = (settings = { provider: "internal", operation: "create_task" }) => ({
  id: "action-1", type: "action", title: "Create task",
  description: "Create a follow-up task.", settings,
});
const condition = (settings = { field: "status", operator: "equals", value: "ready" }) => ({
  id: "condition-1", type: "condition", title: "Check status",
  description: "Only continue when ready.", settings,
});
const valid = (...nodes) => ({ version: 1, nodes });

test("accepts a valid trigger-only draft", () => {
  assert.equal(validateDefinition(valid(trigger())).definition.nodes.length, 1);
});

test("accepts a valid trigger, action, and condition", () => {
  const result = validateDefinition(valid(trigger(), action(), condition()));
  assert.equal(result.definition.nodes.length, 3);
});

test("normalizes titles, descriptions, and setting values", () => {
  const result = validateDefinition(valid({ ...trigger(), title: " Start ", settings: { event: " manual " } }));
  assert.equal(result.definition.nodes[0].title, "Start");
  assert.equal(result.definition.nodes[0].settings.event, "manual");
});

test("rejects non-object definitions a¶»§q«^