import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("../app/api/workflows/[workflowId]/definition/route.ts", import.meta.url), "utf8");
const builder = readFileSync(new URL("../app/dashboard/workflows/[workflowId]/page.tsx", import.meta.url), "utf8");

test("registry save preserves the validated canvas graph, including positions and edges", () => {
  assert.match(route, /edges: \(requestBody\.definition as Record<string, unknown>\)\.edges/);
  assert.match(route, /position: \(\(requestBody\.definition as Record<string, unknown>\)\.nodes/);
  assert.match(route, /definitionToSave = \{[\s\S]*?\.\.\.definitionToSave,[\s\S]*?format: "aivanta-registry-v1",[\s\S]*?steps: validatedRegistry\.steps/);
  assert.doesNotMatch(route, /definitionToSave = \{[\s\S]*?\.\.\.validated\.definition,[\s\S]*?format: "aivanta-registry-v1"/);
});

test("saved graph GET round-trips positions, registry node metadata, and conditional edges", () => {
  assert.match(route, /stored\?\.format === "aivanta-registry-v1"/);
  assert.match(route, /registryNodeId: step\.nodeId/);
  assert.match(route, /registryOperationId: step\.operationId/);
  assert.match(route, /registryInput: step\.input/);
  assert.match(route, /savedNode\?\.position/);
  assert.match(route, /stored && Array\.isArray\(stored\.edges\)/);
});

test("Graph Builder derives registry execution steps from the saved graph before persistence", () => {
  assert.match(builder, /buildRegistrySteps\(definition\)/);
  assert.match(builder, /registrySteps/);
  assert.match(builder, /definition,\s*registrySteps/);
});
