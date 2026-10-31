import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../app/dashboard/builder/page.tsx", import.meta.url), "utf8");

test("builder saves a validated draft to the authenticated workflow APIs", () => {
  assert.match(source, /fetch\("\/api\/workflows",\s*\{[\s\S]*?method: "POST"/);
  assert.match(source, /fetch\(`\/api\/workflows\/\$\{workflowId\}\/definition`,\s*\{[\s\S]*?method: "PATCH"/);
  assert.match(source, /if \(!validationResult\.valid\)/);
  assert.match(source, /status: "draft"/);
  assert.match(source, /It has not been activated or executed/);
});

test("saving a draft again reuses the created workflow instead of duplicating it", () => {
  assert.match(source, /const \[savedWorkflowId, setSavedWorkflowId\] = useState<string \| null>\(null\)/);
  assert.match(source, /let workflowId = savedWorkflowId;[\s\S]*?if \(!workflowId\)/);
  assert.match(source, /setSavedWorkflowId\(workflowId\)/);
});

test("dashboard cache is updated only after the server confirms the definition save", () => {
  const serverSave = source.indexOf('const saveResponse = await fetch(`/api/workflows/${workflowId}/definition`');
  const successCheck = source.indexOf('if (!saveResponse.ok || !saved.success)', serverSave);
  const cacheWrite = source.indexOf('window.localStorage.setItem("aivanta-workflows"', serverSave);
  assert.ok(serverSave >= 0, "definition save API call exists");
  assert.ok(successCheck > serverSave, "server response is checked");
  assert.ok(cacheWrite > successCheck, "local cache is written only after successful server save");
});

test("draft persistence never requests activation or execution", () => {
  const saveStart = source.indexOf("async function saveDraft()");
  const saveEnd = source.indexOf("\n  const currentStep", saveStart);
  const saveBody = source.slice(saveStart, saveEnd);
  assert.doesNotMatch(saveBody, /status:\s*["']active["']/);
  assert.doesNotMatch(saveBody, /\/activate|\/execute|\/run\b/);
});

test("save button exposes a pending state to prevent repeated submissions", () => {
  assert.match(source, /if \(savingDraft\) return/);
  assert.match(source, /disabled=\{savingDraft\}/);
  assert.match(source, /savingDraft \? "Saving…" : "Save draft"/);
});

test("draft save blocks missing or invalid action configuration before calling persistence APIs", () => {
  const saveStart = source.indexOf("async function saveDraft()");
  const saveEnd = source.indexOf("\\n  const currentStep", saveStart);
  const saveBody = source.slice(saveStart, saveEnd);
  assert.match(source, /function getActionConfigurationIssues\\(\\): string\\[\\]/);
  assert.match(saveBody, /const actionIssues = getActionConfigurationIssues\\(\\)/);
  assert.match(saveBody, /if \\(actionIssues.length\\)/);
  assert.match(saveBody, /if \\(catalogLoading\\)/);
  assert.match(saveBody, /if \\(catalogError\\)/);
  assert.ok(saveBody.indexOf("getActionConfigurationIssues()") < saveBody.indexOf('fetch("/api/workflows"'));
});
