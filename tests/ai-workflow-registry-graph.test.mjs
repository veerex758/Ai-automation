import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const generator = readFileSync(new URL("../lib/workflows/ai-workflow-generator.cjs", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/ai/generate-workflow/route.ts", import.meta.url), "utf8");
const builder = readFileSync(new URL("../app/dashboard/workflows/[workflowId]/page.tsx", import.meta.url), "utf8");

test("Gemini planner is explicitly instructed to preserve provider semantics and data dependency direction", () => {
  assert.match(generator, /Map every requested app and action to its exact registered provider and operation/);
  assert.match(generator, /Never replace a named integration with http_request/);
  assert.match(generator, /Gmail List messages step provides its message ID/);
  assert.match(generator, /Edges must follow data dependencies and must never create cycles/);
});

test("AI generation rejects requested Gmail triggers and Sheets writes when the registry does not support them", () => {
  assert.match(route, /getUnsupportedRequestedCapabilities\(body\.prompt, nodeCatalog\)/);
  assert.match(route, /AI_UNSUPPORTED_CAPABILITY/);
  assert.match(route, /unsupportedCapabilities/);
});

test("Gemini registry planning is instructed to return explicit graph edges and conditional paths", () => {
  assert.match(generator, /\{registrySteps:\[\.\.\.\],edges:\[\.\.\.\]\}/);
  assert.match(generator, /true\/false edges/);
  assert.match(generator, /All nodes must be reachable from the trigger/);
});

test("AI generation validates edge endpoints, branch sources, reachability, cycles, and registered inputs", () => {
  assert.match(route, /generated graph must include an explicit connection list/);
  assert.match(route, /Only IF nodes can create true\/false connections/);
  assert.match(route, /Every generated step must be connected to the workflow trigger/);
  assert.match(route, /Every conditional node with downstream work must include true and false paths/);
  assert.match(route, /"registrySteps" in result/);
  assert.match(route, /getExecutableNodeCatalog\(\)/);
  assert.doesNotMatch(route, /getPublicNodeCatalog/);
  assert.match(route, /buildRegistrySteps\(/);
  assert.match(route, /validateRegisteredSteps\(/);
});

test("Graph Builder uses generated graph nodes and edges instead of replacing them with a linear placeholder", () => {
  assert.match(builder, /hasGeneratedGraph/);
  assert.match(builder, /payload\.definition as Definition/);
  assert.match(builder, /edges: steps\.slice\(1\)\.map/);
});


test("Gemini graphs receive a left-to-right layout with distinct upper and lower conditional lanes", () => {
  assert.match(route, /graphDepthById/);
  assert.match(route, /graphLaneById/);
  assert.match(route, /edge\.label === "true" \? -1 : edge\.label === "false" \? 1/);
  assert.match(route, /position: \{ x: 160 \+ depth \* 320, y: 330 \+ lane \* 220 \}/);
  assert.match(builder, /function resolvePosition\(node: WorkflowNode, index: number, seen = new Set<string>\(\)\)/);
  assert.match(builder, /position: undefined/);
});

test("condition guidance accurately describes evaluation during test and live runs", () => {
  assert.doesNotMatch(builder, /Rules are stored in your draft\. They will not be evaluated until execution is implemented\./);
  assert.match(builder, /Conditions evaluate against previous-step outputs during tests and runs/);
  assert.match(builder, /Test both true and false paths before activation/);
});
