import test from "node:test";
import assert from "node:assert/strict";
import dryRun from "../lib/workflows/dry-run.cjs";

const { runDryRun } = dryRun;

const workflow = (nodes) => ({ version: 1, nodes });
const trigger = { id: "trigger", type: "trigger", title: "Manual trigger", description: "", settings: { event: "manual" } };
const action = { id: "action", type: "action", title: "Create task", description: "", settings: { provider: "internal", operation: "create_task" } };
const condition = { id: "condition", type: "condition", title: "Check status", description: "", settings: { field: "status", operator: "equals", value: "ready" } };

test("simulates each step without side effects", () => {
  const result = runDryRun(workflow([trigger, action]));
  assert.equal(result.mode, "dry_run");
  assert.equal(result.status, "succeeded");
  assert.equal(result.sideEffectsPerformed, false);
  assert.deepEqual(result.steps.map((step) => step.status), ["simulated", "simulated"]);
  assert.match(result.steps[1].message, /No external task was created/);
});

test("condition match allows later steps to be simulated", () => {
  const result = runDryRun(workflow([trigger, condition, action]), { status: "ready" });
  assert.equal(result.steps[1].conditionMatched, true);
  assert.equal(result.steps[2].status, "simulated");
});

test("condition mismatch skips later steps", () => {
  const result = runDryRun(workflow([trigger, condition, action]), { status: "waiting" });
  assert.equal(result.steps[1].conditionMatched, false);
  assert.equal(result.steps[2].status, "skipped");
});

test("supports nested input fields without prototype traversal", () => {
  const nested = { ...condition, settings: { field: "record.status", operator: "equals", value: "ready" } };
  assert.equal(runDryRun(workflow([trigger, nested, action]), { record: { status: "ready" } }).steps[1].conditionMatched, true);
  const unsafe = { ...condition, settings: { field: "record.constructor", operator: "is_set" } };
  assert.equal(runDryRun(workflow([trigger, unsafe, action]), { record: {} }).steps[1].conditionMatched, false);
});

test("does not echo input values into step messages", () => {
  const secretLikeValue = "private-customer-value";
  const result = runDryRun(workflow([trigger, action]), { note: secretLikeValue });
  assert.equal(JSON.stringify(result).includes(secretLikeValue), false);
});


test("email and HTTP actions remain side-effect free in dry-run mode", () => {
  const email = { ...action, title: "Send email", settings: { provider: "email", operation: "send_email", recipient: "owner@example.com", message: "Hello" } };
  const webhook = { ...action, title: "HTTP request", settings: { provider: "webhook", operation: "http_request", url: "https://example.com", method: "POST" } };
  const result = runDryRun(workflow([trigger, email, webhook]));
  assert.equal(result.sideEffectsPerformed, false);
  assert.match(result.steps[1].message, /No email was sent/);
  assert.match(result.steps[2].message, /No network request was made/);
});

test("condition paths reject prototype-sensitive segments", () => {
  for (const field of ["__proto__.polluted", "record.prototype", "record.constructor.name"]) {
    const unsafe = { ...condition, settings: { field, operator: "is_set" } };
    const result = runDryRun(workflow([trigger, unsafe, action]), { record: { status: "ready" } });
    assert.equal(result.steps[1].conditionMatched, false, field);
  }
});
