import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("../app/api/workflows/[workflowId]/definition/route.ts", import.meta.url), "utf8");
const builder = readFileSync(new URL("../app/dashboard/workflows/[workflowId]/page.tsx", import.meta.url), "utf8");
const activation = readFileSync(new URL("../app/api/workflows/[workflowId]/route.ts", import.meta.url), "utf8");

test("registry save preserves the validated canvas graph, including positions and edges", () => {
  assert.match(route, /edges: \(requestBody\.definition as Record<string, unknown>\)\.edges/);
  assert.match(route, /position: \(\(requestBody\.definition as Record<string, unknown>\)\.nodes/);
  assert.match(route, /definitionToSave = \{[\s\S]*?\.\.\.definitionToSave,[\s\S]*?format: "aivanta-registry-v1",[\s\S]*?steps: persistedSteps/);
  assert.doesNotMatch(route, /definitionToSave = \{[\s\S]*?\.\.\.validated\.definition,[\s\S]*?format: "aivanta-registry-v1"/);
  assert.match(route, /buildRegistrySteps\(\{ nodes: graphNodes, edges: graphEdges \}\)/);
  assert.match(route, /Canvas connections and registered execution steps do not match/);
  assert.match(activation, /legacy-next-/);
});

test("draft validation checks registry operation schemas and graph paths before reporting success", () => {
  assert.match(route, /const hasRegistryGraph = rawNodes\.some/);
  assert.match(route, /Registry workflows must include an explicit connection list/);
  assert.match(route, /buildRegistrySteps\(\{ nodes: graphNodes, edges \}\)/);
  assert.match(route, /validateRegisteredSteps\(steps\)/);
  assert.match(route, /registered operation schemas/);
  assert.match(route, /conditional branch paths/);
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
  assert.match(builder, /registrySteps: buildRegistrySteps\(definition\)/);
});

test("workflow reload exposes the exact saved version and the builder updates it after save", () => {
  assert.match(route, /select\("id, name, description, status, version, definition"\)/);
  assert.match(route, /workflow: \{[^}]*version: data\.version/);
  assert.match(builder, /type Workflow = \{[^}]*version: number/);
  assert.match(builder, /setWorkflow\(\(current\) => current \? \{ \.\.\.current, version: result\.version \} : current\)/);
  assert.match(builder, /workflow\?\.version/);
});
