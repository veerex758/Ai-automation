import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("../app/api/workflows/route.ts", import.meta.url), "utf8");
const validator = readFileSync(new URL("../nodes/validate-steps.ts", import.meta.url), "utf8");
const setup = readFileSync(new URL("../app/dashboard/playbooks/new/page.tsx", import.meta.url), "utf8");

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

test("workflow creation validates the graph and persists the matching registered execution plan", () => {
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

test("workflow create path validates Playbook rules and action policies before persistence", () => {
  assert.match(route, /validatePlaybookDefinition/);
  assert.match(route, /registryStepsForPlaybook/);
  assert.match(route, /definitionToSave\.playbook = checkedPlaybook\.playbook/);
});

test("quick-create still receives a valid manual-trigger starter definition", () => {
  assert.match(route, /: validateDefinition\(\{\s*version: 1,\s*nodes: \[\{\s*id: "trigger-1",\s*type: "trigger",[\s\S]*?settings: \{ event: "manual" \}/);
});

test("Playbook setup sends one complete inactive definition with reviewed permissions", () => {
  assert.match(setup, /const definition = \{ \.\.\.draft\.definition, playbook \}/);
  assert.match(setup, /status: "draft"/);
  assert.match(setup, /registrySteps: draft\.registrySteps/);
  assert.match(setup, /router\.push\("\/dashboard\/playbooks\//);
  assert.doesNotMatch(setup, /status: "active"|\/activate|\/execute/);
});
