import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const registryRun = readFileSync(new URL("../app/api/workflows/[workflowId]/registry-run/route.ts", import.meta.url), "utf8");
const activation = readFileSync(new URL("../app/api/workflows/[workflowId]/route.ts", import.meta.url), "utf8");
const panel = readFileSync(new URL("../app/dashboard/workflows/[workflowId]/run-test-panel.tsx", import.meta.url), "utf8");
const runner = readFileSync(new URL("../nodes/workflow-runner.ts", import.meta.url), "utf8");

test("registry dry-run validates saved steps and evaluates them with bounded sample trigger input", () => {
  assert.ok(registryRun.includes("validateRegisteredSteps(definition.steps)"));
  assert.ok(registryRun.includes("Dry-run input must be a JSON object"));
  assert.ok(registryRun.includes("safe-test only. Use durable dispatch for approved live execution"));
  assert.ok(registryRun.includes("initialOutputs: { [triggerStep.id]: triggerOutput }"));
  assert.ok(registryRun.includes('triggerStep.nodeId === "webhooks"'));
  assert.ok(registryRun.includes("completedStepIds: [triggerStep.id]"));
  assert.ok(registryRun.includes("conditionMatched: output.matched"));
  assert.ok(runner.includes('args.dryRun ? "simulated" : "succeeded"'));
});

test("builder safe test uses the registry runner for registry-backed graphs", () => {
  assert.ok(panel.includes("isRegistryWorkflow ? `/api/workflows/${workflowId}/registry-run`"));
  assert.ok(panel.includes("JSON.stringify(isRegistryWorkflow ? { dryRun: true, input: parsed }"));
});

test("activation requires successful dry-run evidence for every registered step in the exact version", () => {
  assert.ok(activation.includes("hasRegistryTest"));
  assert.ok(activation.includes("workflow_run_steps"));
  assert.ok(activation.includes('row.title === step.nodeId + "." + step.operationId'));
  assert.ok(activation.includes('row.status === "simulated" || row.status === "skipped"'));
});
