import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../app/dashboard/playbooks/new/page.tsx", import.meta.url), "utf8");

test("Playbook setup saves the validated graph and policy envelope as one inactive draft", () => {
  assert.match(source, /fetch\("\/api/ai/generate-workflow"/);
  assert.match(source, /fetch\("/api/workflows"/);
  assert.match(source, /status: "draft"/);
  assert.match(source, /const definition = \{ \.\.\.draft\.definition, playbook \}/);
  assert.match(source, /registrySteps: draft\.registrySteps/);
  assert.match(source, /router\.push\("\/dashboard\/playbooks\//);
});

test("permission settings are explicit and no missing permission is converted to auto", () => {
  assert.match(source, /permission: step\.nodeId === "gemini" \? "auto" as const : "ask_first" as const/);
  assert.match(source, /actionPolicies: policies/);
  assert.match(source, /ask_first/);
  assert.match(source, /never/);
});

test("draft setup has no browser-local workflow source of truth", () => {
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
});

test("Playbook setup never activates or dispatches the generated workflow", () => {
  assert.doesNotMatch(source, /status:\s*["']active["']/);
  assert.doesNotMatch(source, /\/activate|\/execute|\/dispatch|\/run\b/);
});
