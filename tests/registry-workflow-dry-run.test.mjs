import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const registryRun = readFileSync(new URL("../app/api/workflows/[workflowId]/registry-run/route.ts", import.meta.url), "utf8");
const activation = readFileSync(new URL("../app/api/workflows/[workflowId]/route.ts", import.meta.url), "utf8");
const panel = readFileSync(new URL("../app/dashboard/workflows/[workflowId]/run-test-panel.tsx", import.meta.url), "utf8");
const runner = readFileSync(new URL("../nodes/workflow-runner.ts", import.meta.url), "utf8");

test("registry dry-run validates saved steps and evaluates them with bounded sample trigger input", () => {
  assert.match(registryRun, /validateRegisteredSteps\(definition\.steps\)/);
  assert.match(registryRun, /Dry-run input must be a JSON object/);
  assert.match(registryRun, /initialOutputs: \{ \[triggerStep\.id\]: \{ started: true, payload: input \} \}/);
  assert.match(registryRun, /completedStepIds: \[triggerStep\.id\]/);
  assert.match(registryRun, /conditionMatched: output\.matched/);
  assert.match(runner, /args\.dryRun \? "simulated" : "succeeded"/);
});

test("builder safe test uses the registry runner for registry-backed graphs", () => {
  assert.match(panel, /isRegistryWorkflow \? `\/api\/workflows\/\$\{workflowId\}\/registry-run`/);
  assert.match(panel, /JSON\.stringify\(isRegistryWorkflow \? \{ dryRun: true, input: parsed \}/);
});

test("activation requires successful dry-run evidence for every registered step in the exact version", () => {
  assert.match(activation, /hasRegistryTest/);
  assert.match(activation, /workflow_run_steps/);
  assert.match(activation, /row\.title === step\.nodeId \+ "\." \+ step\.operationId/);
  assert.match(activation, /row\.status === "simulated" \|\| row\.status === "skipped"/);
});
