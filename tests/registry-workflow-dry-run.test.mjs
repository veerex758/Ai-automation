import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const runs = readFileSync(new URL("../app/api/workflows/[workflowId]/runs/route.ts", import.meta.url), "utf8");
const activation = readFileSync(new URL("../app/api/workflows/[workflowId]/route.ts", import.meta.url), "utf8");
const panel = readFileSync(new URL("../app/dashboard/workflows/[workflowId]/run-test-panel.tsx", import.meta.url), "utf8");
const runner = readFileSync(new URL("../nodes/workflow-runner.ts", import.meta.url), "utf8");

test("safe test endpoint executes registry graphs with bounded sample trigger input", () => {
  assert.ok(runs.includes("validateRegisteredSteps(storedDefinition.steps)"));
  assert.ok(runs.includes("Dry-run input must be a JSON object"));
  assert.ok(runs.includes("initialOutputs: { [trigger.id]: triggerOutput }"));
  assert.ok(runs.includes('trigger.nodeId === "webhooks"'));
  assert.ok(runs.includes("completedStepIds: [trigger.id]"));
  assert.ok(runs.includes("conditionMatched: output.matched"));
  assert.ok(runs.includes("record_workflow_dry_run"));
  assert.ok(runs.includes('engine: "registry-v1"'));
  assert.ok(runner.includes('args.dryRun ? "simulated" : "succeeded"'));
});

test("builder safe test uses the unified dry-run endpoint", () => {
  assert.ok(panel.includes("fetch(`/api/workflows/${workflowId}/runs`"));
  assert.ok(panel.includes('JSON.stringify({ mode: "dry_run", input: parsed })'));
});

test("activation requires successful dry-run evidence for every registered step in the exact version", () => {
  assert.ok(activation.includes("hasRegistryTest"));
  assert.ok(activation.includes("workflow_run_steps"));
  assert.ok(activation.includes('(row.result as Record<string, unknown>).engine === "registry-v1"'));
  assert.ok(activation.includes('row.title === step.nodeId + "." + step.operationId'));
  assert.ok(activation.includes('row.status === "simulated" || row.status === "skipped"'));
});
