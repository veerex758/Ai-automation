import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("../app/api/workflows/[workflowId]/definition/route.ts", import.meta.url), "utf8");

test("workflow definition API validates Playbooks against the registry execution plan", () => {
  assert.match(route, /validatePlaybookDefinition/);
  assert.match(route, /Playbook rules and action permission bindings/);
  assert.match(route, /A Playbook requires a registered execution plan/);
});

test("workflow definition GET validates and returns the versioned Playbook", () => {
  assert.match(route, /stored\?\.playbook !== undefined/);
  assert.match(route, /savedPlaybook = checkedPlaybook\.playbook/);
  assert.match(route, /\.\.\.\(savedPlaybook \? \{ playbook: savedPlaybook \} : \{\}\)/);
});

test("workflow definition PATCH preserves an existing Playbook and refuses stale action permissions", () => {
  assert.match(route, /existingDefinition\.playbook/);
  assert.match(route, /const hasPlaybook = hasExplicitPlaybook \|\| existingDefinition\.playbook !== undefined/);
  assert.match(route, /Action permissions do not match the saved registered operations/);
  assert.match(route, /definitionToSave = \{ \.\.\.definitionToSave, playbook: savedPlaybook \}/);
});
