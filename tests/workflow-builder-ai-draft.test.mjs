import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../app/dashboard/workflows/[workflowId]/page.tsx", import.meta.url), "utf8");
const assistant = readFileSync(new URL("../app/dashboard/ai-assistant/page.tsx", import.meta.url), "utf8");


test("visual graph canvas supports zoom, fit-to-view, background pan, and scale-aware node dragging", () => {
  assert.match(page, /function fitGraphToView\(\)/);
  assert.match(page, /function zoomGraphTo\(/);
  assert.match(page, /onWheel=\{handleGraphWheel\}/);
  assert.match(page, /onPointerDown=\{beginGraphPan\}/);
  assert.match(page, /onPointerMove=\{moveGraphPan\}/);
  assert.match(page, /aria-label="Fit graph to view"/);
  assert.match(page, /transform: `translate\(\$\{camera\.x\}px, \$\{camera\.y\}px\) scale\(\$\{camera\.scale\}\)`/);
  assert.match(page, /\(event\.clientX - drag\.startX\) \/ camera\.scale/);
  assert.match(page, /provider\?\.icon \|\| nodeMeta\[node\.type\]\.icon/);
});

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

test("AI Assistant creates an inactive validated draft and opens the visual Builder immediately", () => {
  assert.match(assistant, /Generate on visual canvas/);
  assert.match(assistant, /status: "draft"/);
  assert.match(assistant, /router\.push\(\\?`\/dashboard\/workflows/);
  assert.match(assistant, /REXNORA AI WORKFLOW DESIGNER/);
  assert.doesNotMatch(assistant, /generated-node|Review validated draft in Builder/);
});

test("AI-generated graph drafts remain review-only and are not auto-executed", () => {
  assert.match(page, /Review and edit it, then Save workflow; it has not been executed\./);
  assert.match(page, /async function saveDefinition\(\)/);
  assert.match(page, /async function activateWorkflow\(\)/);
});
