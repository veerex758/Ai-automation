/* global require */
const test = require("node:test");
const assert = require("node:assert/strict");
const { validateDefinition } = require("../lib/workflows/validate-definition.cjs");

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

test("rejects non-object definitions and unsupported versions", () => {
  assert.match(validateDefinition(null).error, /must be an object/i);
  assert.match(validateDefinition({ version: 2, nodes: [trigger()] }).error, /version 1/i);
});

test("rejects empty drafts and more than 30 steps", () => {
  assert.match(validateDefinition(valid()).error, /Add a trigger/i);
  assert.match(validateDefinition(valid(trigger(), ...Array.from({ length: 30 }, (_, i) => ({ ...action(), id: `a-${i}` })))).error, /at most 30/i);
});

test("rejects duplicate IDs and malformed step IDs", () => {
  assert.match(validateDefinition(valid(trigger(), { ...action(), id: "trigger-1" })).error, /unique/i);
  assert.match(validateDefinition(valid({ ...trigger(), id: "bad id" })).error, /unique/i);
});

test("requires the first step to be the only trigger", () => {
  assert.match(validateDefinition(valid(action())).error, /first step must be a trigger/i);
  assert.match(validateDefinition(valid(trigger(), { ...trigger(), id: "trigger-2" })).error, /only have one trigger/i);
});

test("rejects unsupported step types and settings", () => {
  assert.match(validateDefinition(valid({ ...trigger(), type: "unknown" })).error, /trigger, action, or condition/i);
  assert.match(validateDefinition(valid({ ...trigger(), settings: { event: "manual", secret: "x" } })).error, /unsupported field/i);
  assert.match(validateDefinition(valid({ ...trigger(), settings: { event: 42 } })).error, /invalid value/i);
  assert.match(validateDefinition(valid({ ...trigger(), settings: { event: "x".repeat(501) } })).error, /invalid value/i);
});

test("rejects unsupported trigger events", () => {
  assert.match(validateDefinition(valid(trigger({ event: "unknown" }))).error, /supported trigger event/i);
});

test("enforces provider and operation compatibility", () => {
  assert.match(validateDefinition(valid(trigger(), action({ provider: "email", operation: "create_task" }))).error, /matches the selected service/i);
  assert.match(validateDefinition(valid(trigger(), action({ provider: "unknown", operation: "create_task" }))).error, /supported action provider/i);
});

test("validates email and Slack recipients", () => {
  assert.match(validateDefinition(valid(trigger(), action({ provider: "email", operation: "send_email", recipient: "bad-address" }))).error, /valid recipient email/i);
  assert.match(validateDefinition(valid(trigger(), action({ provider: "slack", operation: "send_message", recipient: "" }))).error, /Slack channel or recipient/i);
  assert.ok(validateDefinition(valid(trigger(), action({ provider: "email", operation: "send_email", recipient: "ops@example.com" }))).definition);
});

test("only accepts valid HTTPS webhook URLs", () => {
  assert.match(validateDefinition(valid(trigger(), action({ provider: "webhook", operation: "http_request", url: "http://example.com/hook" }))).error, /HTTPS/i);
  assert.match(validateDefinition(valid(trigger(), action({ provider: "webhook", operation: "http_request", url: "not a URL" }))).error, /valid HTTPS/i);
  assert.ok(validateDefinition(valid(trigger(), action({ provider: "webhook", operation: "http_request", url: "https://example.com/hook" }))).definition);
});

test("requires valid condition fields and operators", () => {
  assert.match(validateDefinition(valid(trigger(), condition({ field: "", operator: "equals", value: "x" }))).error, /field/i);
  assert.match(validateDefinition(valid(trigger(), condition({ field: "status", operator: "unknown", value: "x" }))).error, /condition operator/i);
  assert.match(validateDefinition(valid(trigger(), condition({ field: "status", operator: "equals", value: "" }))).error, /expected value/i);
  assert.ok(validateDefinition(valid(trigger(), condition({ field: "status", operator: "is_set" }))).definition);
});
