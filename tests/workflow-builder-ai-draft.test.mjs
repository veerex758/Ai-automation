import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../app/dashboard/workflows/[workflowId]/page.tsx", import.meta.url), "utf8");

test("workflow builder maps validated registry generation steps onto editable graph nodes", () => {
  assert.match(page, /registrySteps\?: Array</);
  assert.match(page, /const steps = Array\.isArray\(payload\.registrySteps\) \? payload\.registrySteps : \[\]/);
  assert.match(page, /registryNodeId: step\.nodeId/);
  assert.match(page, /registryOperationId: step\.operationId/);
  assert.match(page, /registryInput: step\.input/);
  assert.match(page, /title: operation\?\.name \|\| provider\?\.name \|\| step\.operationId/);
});

test("workflow builder preserves generated step order as explicit editable graph edges", () => {
  assert.match(page, /edges: steps\.slice\(1\)\.map/);
  assert.match(page, /source: steps\[index\]\.id/);
  assert.match(page, /target: step\.id/);
  assert.match(page, /label: "next" as const/);
});

test("AI-generated graph drafts remain review-only and are not auto-executed", () => {
  assert.match(page, /Review and edit it, then Save workflow; it has not been executed\./);
  assert.match(page, /async function saveDefinition\(\)/);
  assert.match(page, /async function activateWorkflow\(\)/);
});
