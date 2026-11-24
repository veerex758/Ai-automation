import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../app/dashboard/playbooks/new/page.tsx", import.meta.url), "utf8");

test("Playbook setup saves the validated graph and policy envelope as one inactive draft", () => {
  assert.ok(source.includes('fetch("/api/ai/generate-workflow"'));
  assert.ok(source.includes('fetch("/api/workflows"'));
  assert.ok(source.includes('status: "draft"'));
  assert.ok(source.includes("const definition = { ...draft.definition, playbook }"));
  assert.ok(source.includes("registrySteps: draft.registrySteps"));
  assert.ok(source.includes('router.push("/dashboard/playbooks/"'));
});

test("permission settings are explicit and no missing permission is converted to auto", () => {
  assert.ok(source.includes('permission: step.nodeId === "gemini" ? "auto" as const : "ask_first" as const'));
  assert.ok(source.includes("actionPolicies: policies"));
  assert.ok(source.includes('"ask_first"'));
  assert.ok(source.includes('"never"'));
});

test("draft setup has no browser-local workflow source of truth", () => {
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
});

test("Playbook setup never activates or dispatches the generated workflow", () => {
  assert.doesNotMatch(source, /status:\s*["\']active["\']/);
  assert.doesNotMatch(source, /\/activate|\/execute|\/dispatch|\/run\b/);
});
