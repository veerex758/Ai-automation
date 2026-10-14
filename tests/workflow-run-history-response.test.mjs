import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("../app/api/workflows/[workflowId]/runs/route.ts", import.meta.url), "utf8");

test("run history selects only metadata needed by the history UI", () => {
  assert.match(route, /from\("workflow_run_steps"\)\s*\.select\("id, run_id, position, title, status"\)/);
  assert.doesNotMatch(route, /\.select\([^\n]*\bresult\b/);
  assert.doesNotMatch(route, /\.select\([^\n]*\binput\b|\.select\([^\n]*\boutput\b|\.select\([^\n]*provider_payload/);
});

test("run history responses are private and non-cacheable", () => {
  assert.match(route, /response\.headers\.set\("Cache-Control", "private, no-store"\)/);
  assert.match(route, /return privateJson\(\{\s*runs:/);
  assert.doesNotMatch(route, /return NextResponse\.json\(/);
});

test("run history remains scoped to the requested workflow and its workspace", () => {
  assert.match(route, /\.eq\("workflow_id", workflowId\)/);
  assert.match(route, /\.eq\("workspace_id", workflow\.workspace_id\)/);
  assert.match(route, /\.in\("run_id", runIds\)/);
});
