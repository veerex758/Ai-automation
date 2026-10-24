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

test("save button exposes a pending state to prevent repeated submissions", () => {
  assert.match(source, /if \(savingDraft\) return/);
  assert.match(source, /disabled=\{savingDraft\}/);
  assert.match(source, /savingDraft \? "Saving…" : "Save draft"/);
});
