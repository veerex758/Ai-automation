import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { validateDefinition } = require("../lib/workflows/validate-definition.cjs");

const route = readFileSync(new URL("../app/api/workflows/[workflowId]/definition/route.ts", import.meta.url), "utf8");
const createRoute = readFileSync(new URL("../app/api/workflows/route.ts", import.meta.url), "utf8");
const assistant = readFileSync(new URL("../app/dashboard/ai-assistant/page.tsx", import.meta.url), "utf8");
const builder = readFileSync(new URL("../app/dashboard/workflows/[workflowId]/page.tsx", import.meta.url), "utf8");
const activation = readFileSync(new URL("../app/api/workflows/[workflowId]/route.ts", import.meta.url), "utf8");


test("saving the graph persists resolved coordinates for every node and keeps the saved layout clean", () => {
  assert.match(builder, /nodes: definition\.nodes\.map\(\(node, index\) => \(\{ \.\.\.node, position: nodePosition\(node, index\) \}\)\)/);
  assert.match(builder, /definition: \{ \.\.\.definitionToSave/);
  assert.match(builder, /registrySteps: buildRegistrySteps\(definitionToSave\)/);
  assert.match(builder, /setDefinition\(definitionToSave\)/);
  assert.match(builder, /setSavedFingerprint\(JSON\.stringify\(definitionToSave\)\)/);
  assert.match(route, /savedNode\?\.position/);
  assert.match(route, /stored && Array\.isArray\(stored\.edges\)/);
});

test("registry save preserves the validated canvas graph, including positions and edges", () => {
  assert.match(route, /edges: \(requestBody\.definition as Record<string, unknown>\)\.edges/);
  assert.match(route, /position: \(\(requestBody\.definition as Record<string, unknown>\)\.nodes/);
  assert.match(route, /definitionToSave = \{[\s\S]*?\.\.\.definitionToSave,[\s\S]*?format: "aivanta-registry-v1",[\s\S]*?steps: persistedSteps/);

  assert.match(route, /buildRegistrySteps\(\{ nodes: graphNodes, edges: graphEdges \}\)/);
  assert.match(route, /Canvas connections and registered execution steps do not match/);
  assert.match(route, /definitionToSave = \{[\s\S]*?\.\.\.definitionToSave,[\s\S]*?format: "aivanta-registry-v1",/);
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

test("registry metadata never contaminates the node-type-specific legacy settings schema", () => {
  assert.doesNotMatch(route, /settings:\s*\{\s*\.\.\.node\.settings,\s*provider:\s*step\.nodeId,\s*operation:\s*step\.operationId\s*\}/);
  assert.match(route, /registryNodeId: step\.nodeId,[\s\S]*?registryOperationId: step\.operationId,[\s\S]*?registryInput: step\.input/);
});

test("a reloaded registry graph remains valid under the legacy node-type settings schema", () => {
  const definition = {
    version: 1,
    nodes: [
      { id: "trigger", type: "trigger", title: "Webhook", description: "Receive an event.", settings: { event: "webhook" }, registryNodeId: "webhooks", registryOperationId: "receive_event", registryInput: { eventId: "evt_1" } },
      { id: "condition", type: "condition", title: "Qualified?", description: "Check the lead.", settings: { field: "{{trigger.payload.qualified}}", operator: "equals", value: "true" }, registryNodeId: "if", registryOperationId: "evaluate", registryInput: { value: "{{trigger.payload.qualified}}", operator: "equals", compareTo: "true" } },
      { id: "yes", type: "action", title: "Approved path", description: "Continue.", settings: { provider: "internal", operation: "create_task" }, registryNodeId: "slack", registryOperationId: "post_message", registryInput: { message: "Qualified lead" } },
      { id: "no", type: "action", title: "Rejected path", description: "Stop.", settings: { provider: "internal", operation: "create_task" }, registryNodeId: "slack", registryOperationId: "post_message", registryInput: { message: "Needs review" } },
    ],
    edges: [
      { id: "e1", source: "trigger", target: "condition", label: "next" },
      { id: "e2", source: "condition", target: "yes", label: "true" },
      { id: "e3", source: "condition", target: "no", label: "false" },
    ],
  };
  const validated = validateDefinition(definition);
  assert.ok(validated.definition, validated.error);
  assert.deepEqual(validated.definition.nodes[0].settings, { event: "webhook" });
  assert.deepEqual(validated.definition.nodes[1].settings, { field: "{{trigger.payload.qualified}}", operator: "equals", value: "true" });
});

test("Graph Builder derives registry execution steps from the saved graph before persistence", () => {
  assert.match(builder, /buildRegistrySteps\(definitionToSave\)/);
  assert.match(builder, /registrySteps/);
  assert.match(builder, /registrySteps: buildRegistrySteps\(definitionToSave\)/);
});

test("workflow reload exposes the exact saved version and the builder updates it after save", () => {
  assert.match(route, /select\("id, name, description, status, version, definition"\)/);
  assert.match(route, /workflow: \{[^}]*version: data\.version/);
  assert.match(builder, /type Workflow = \{[^}]*version: number/);
  assert.match(builder, /setWorkflow\(\(current\) => current \? \{ \.\.\.current, version: result\.version \} : current\)/);
  assert.match(builder, /workflow\?\.version/);
});

test("AI Assistant draft creation preserves the editable graph and validated registry plan", () => {
  assert.ok(createRoute.includes("buildRegistrySteps("));
  assert.ok(createRoute.includes("validateRegisteredSteps(rebuilt)"));
  assert.ok(createRoute.includes("Canvas connections and registered execution steps do not match"));
  assert.ok(createRoute.includes("edges: rawDefinition.edges"));
  assert.ok(createRoute.includes('format: "aivanta-registry-v1", steps: checked.steps'));
  assert.ok(assistant.includes("/dashboard/workflows/"));
  assert.ok(!assistant.includes("/dashboard/connections?workflowId="));
});
