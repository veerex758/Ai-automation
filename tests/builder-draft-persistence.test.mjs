import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("../app/dashboard/builder/page.tsx", import.meta.url), "utf8");
test("starter workflow actions have configured catalog actions", () => {
  assert.match(source, /actionId: "internal\.create_task"/);
  assert.match(source, /message: "Review the new lead details/);
  assert.match(source, /message: "Assign an owner/);
  assert.match(source, /settings: \{ event: "webhook" \}/);
});
test("builder saves validated drafts using authenticated workflow APIs", () => {
  assert.match(source, /fetch\("\/api\/workflows",\s*\{[\s\S]*?method: "POST"/);
  assert.match(source, /fetch\([\s\S]*?`\/api\/workflows\/\$\{workflowId\}\/definition`,[\s\S]*?method: "PATCH"/);
  assert.match(source, /if \(!validationResult\.valid\)/);
  assert.match(source, /status: "draft"/);
  assert.match(source, /It has not been activated or executed/);
});
test("saving again reuses workflow and doesn't duplicate it", () => {
  assert.match(source, /const \[savedWorkflowId, setSavedWorkflowId\] = useState<string \| null>\(null\)/);
  assert.match(source, /let workflowId = savedWorkflowId;[\s\S]*?if \(!workflowId\)/);
  assert.match(source, /setSavedWorkflowId\(workflowId\)/);
});
test("dashboard cache updates after server confirms definition save", () => {
  const saveStart = source.indexOf("const saveResponse = await fetch(");
  const success = source.indexOf("if (!saveRe¶»§q«^