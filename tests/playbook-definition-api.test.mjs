import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("../app/api/workflows/[workflowId]/definition/route.ts", import.meta.url), "utf8");
const validator = readFileSync(new URL("../lib/playbooks/definition.cjs", import.meta.url), "utf8");
const activation = readFileSync(new URL("../app/api/workflows/[workflowId]/route.ts", import.meta.url), "utf8");

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
  assert.match(validator, /Action permissions do not match the saved registered operations/);
  assert.match(route, /definitionToSave = \{ \.\.\.definitionToSave, playbook: savedPlaybook \}/);
});

test("Playbook activation is limited to the implemented real-estate runtime and all server gates", () => {
  assert.match(activation, /stored\?\.playbook !== undefined/);
  assert.match(activation, /validatePlaybookDefinition/);
  assert.match(activation, /REAL_ESTATE_PIPELINE_ENABLED/);
  assert.match(activation, /PLAYBOOK_POLICY_INVALID/);
  assert.match(activation, /validateDurableLiveSteps/);
  assert.match(activation, /Run a successful test of this exact saved workflow version/);
  assert.match(activation, /WORKSPACE_CONNECTION_NOT_VERIFIED/);
  assert.match(activation, /Approve .* in workspace integration permissions/);
  assert.doesNotMatch(activation, /PLAYBOOK_RUNTIME_POLICY_NOT_ENFORCED/);
});


test("activation applies only to the exact workflow version that passed server-side validation", () => {
  assert.match(activation, /let activationVersion: number \| null = null/);
  assert.match(activation, /activationVersion = candidate\.version/);
  assert.match(activation, /updateQuery = updateQuery\.eq\("version", activationVersion\)/);
  assert.match(activation, /PLAYBOOK_VERSION_CHANGED_DURING_ACTIVATION/);
  assert.match(activation, /Reload, test and review the latest saved version/);
});
