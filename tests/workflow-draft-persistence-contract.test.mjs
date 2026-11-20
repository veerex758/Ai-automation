import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("../app/api/workflows/route.ts", import.meta.url), "utf8");
const validator = readFileSync(new URL("../nodes/validate-steps.ts", import.meta.url), "utf8");
const builder = readFileSync(new URL("../app/dashboard/builder/page.tsx", import.meta.url), "utf8");

test("new workflow creation inserts an empty row before saving the validated definition through the RPC", () => {
  const emptyInsert = route.indexOf('.insert({');
  const saveRpc = route.indexOf('supabase.rpc("save_workflow_definition"');
  assert.ok(emptyInsert >= 0 && saveRpc > emptyInsert);
  const insertBlock = route.slice(emptyInsert, route.indexOf('.select("id, name, description, status, updated_at")', emptyInsert));
  assert.doesNotMatch(insertBlock, /definition:/);
  assert.match(route, /p_workflow_id: createdWorkflow\.id/);
  assert.match(route, /p_definition: definitionToSave/);
  assert.match(route, /Failed to clean up an unsaved workflow draft/);
});

test("workflow creation validates the submitted graph and persists its matching registered execution plan", () => {
  assert.match(route, /import \{ validateDefinition \} from "@\/lib\/workflows\/validate-definition\.cjs";/);
  assert.match(route, /"definition" in body\s*\? validateDefinition\(body\.definition\)/);
  assert.match(route, /status: 422/);
  assert.ok(route.includes("p_definition: definitionToSave"));
  assert.match(route, /registrySteps/);
  assert.match(route, /import \{ buildRegistrySteps \} from "@\/lib\/workflows\/build-registry-steps";/);
  assert.match(route, /import \{ validateRegisteredSteps \} from "@\/nodes\/validate-steps";/);
  assert.match(route, /rebuilt = buildRegistrySteps\(\{[\s\S]*?edges: rawDefinition\.edges/);
  assert.match(route, /const checked = validateRegisteredSteps\(rebuilt\)/);
  assert.match(route, /Canvas connections and registered execution steps do not match/);
  assert.match(validator, /findOperation\(step\.nodeId, step\.operationId, step\.kind\)/);
  assert.match(validator, /operation\.inputSchema\.safeParse\(step\.input\)/);
});

test("quick-create and template creation receive a valid manual-trigger starter definition", () => {
  assert.match(route, /: validateDefinition\(\{\s*version: 1,\s*nodes: \[\{\s*id: "trigger-1",\s*type: "trigger",[\s\S]*?settings: \{ event: "manual" \}/);
  assert.ok(route.includes("p_definition: definitionToSave"));
});

test("builder sends a new workflow definition with creation and only patches existing drafts", () => {
  assert.match(builder, /const isNewWorkflow = !workflowId;/);
  assert.match(builder, /status: "draft",\s*definition,/);
  assert.match(builder, /if \(!isNewWorkflow\)\s*\{\s*const saveResponse = await fetch\(\`\/api\/workflows\/\$\{workflowId\}\/definition\`/);
  assert.match(builder, /Workflow draft saved to your Rexnora workspace/);
  assert.match(builder, /It has not been activated or executed/);
});
