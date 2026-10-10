import test from "node:test";
import assert from "node:assert/strict";
import engine from "../lib/workflows/execute-dry-run.cjs";

const { runDryRun, readPath, compareCondition } = engine;

const base = {
  version: 1,
  nodes: [
    { id: "start", type: "trigger", title: "Manual start", description: "", settings: { event: "manual" } },
    { id: "task", type: "action", title: "Create task", description: "", settings: { provider: "internal", operation: "create_task", message: "Review order" } },
  ],
};

test("simulates trigger and action in order without invoking providers", () => {
  const result = runDryRun(base, {});
  assert.equal(result.status, "succeeded");
  assert.equal(result.mode, "dry_run");
  assert.deepEqual(result.steps.map((step) => step.status), ["simulated", "simulated"]);
  assert.equal(result.steps[1].result.simulated, true);
  assert.match(result.steps[1].result.message, /side effects are disabled/);
});

test("evaluates nested field equality", () => {
  const definition = { version: 1, nodes: [
    base.nodes[0],
    { id: "check", type: "condition", title: "Check total", description: "", settings: { field: "order.total", operator: "equals", value: "125" } },
    base.nodes[1],
  ] };
  const result = runDryRun(definition, { order: { total: 125 } });
  assert.equal(result.steps[1].result.matched, true);
  assert.equal(result.steps[2].status, "simulated");
});

test("skips later steps when a condition does not match", () => {
  const definition = { version: 1, nodes: [
    base.nodes[0],
    { id: "check", type: "condition", title: "Check total", description: "", settings: { field: "order.total", operator: "greater_than", value: "100" } },
    base.nodes[1],
  ] };
  const result = runDryRun(definition, { order: { total: 20 } });
  assert.equal(result.steps[1].result.matched, false);
  assert.equal(result.steps[2].status, "skipped");
});

test("supports contains, numeric comparisons, and is_set", () => {
  assert.equal(compareCondition("hello world", "contains", "world"), true);
  assert.equal(compareCondition(9, "greater_than", "8"), true);
  assert.equal(compareCondition("3", "less_than", "4"), true);
  assert.equal(compareCondition(false, "is_set", ""), true);
  assert.equal(compareCondition(undefined, "is_set", ""), false);
});

test("blocks unsafe object property paths", () => {
  const input = JSON.parse('{"safe":{"value":"yes"},"constructor":{"prototype":{"polluted":true}}}');
  assert.equal(readPath(input, "safe.value"), "yes");
  assert.equal(readPath(input, "constructor.prototype.polluted"), undefined);
  assert.equal(readPath(input, "__proto__.polluted"), undefined);
});

test("rejects invalid definitions and non-object input", () => {
  assert.throws(() => runDryRun({ version: 1, nodes: [] }, {}), /trigger/);
  assert.throws(() => runDryRun(base, []), /JSON object/);
});

test("rejects oversized test input", () => {
  assert.throws(() => runDryRun(base, { value: "x".repeat(20001) }), /20 KB/);
});

test("does not copy submitted input into persisted step results", () => {
  const secret = "should-not-appear-in-results";
  const result = runDryRun(base, { secret });
  assert.equal(JSON.stringify(result.steps).includes(secret), false);
});
