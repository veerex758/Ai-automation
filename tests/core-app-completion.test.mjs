import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [dashboard, metrics, workspaces, switchRoute, workflowCollection, workflowItem, workflowRuns, dispatch, executionStatus] = await Promise.all([
  read("../app/dashboard/page.tsx"),
  read("../app/api/dashboards/metrics/route.ts"),
  read("../app/api/workspaces/route.ts"),
  read("../app/api/workspaces/[workspaceId]/switch/route.ts"),
  read("../app/api/workflows/route.ts"),
  read("../app/api/workflows/[workflowId]/route.ts"),
  read("../app/api/workflows/[workflowId]/runs/route.ts"),
  read("../app/api/workflows/[workflowId]/dispatch/route.ts"),
  read("../app/api/workflows/[workflowId]/executions/[jobId]/route.ts"),
]);

test("dashboard uses workspace-scoped metrics instead of illustrative sample values", () => {
  assert.match(dashboard, /\/api\/dashboards\/metrics/);
  assert.match(dashboard, /\/api\/workspaces/);
  assert.match(dashboard, /workspace-select/);
  assert.match(dashboard, /switchWorkspace\(event\.target\.value\)/);
  assert.match(dashboard, /dashboardMetrics\.success_rate/);
  assert.doesNotMatch(dashboard, /2,392|48\.5|sample data|Illustrative dashboard metric/);
  assert.match(metrics, /auth\.getUser\(\)/);
  assert.match(metrics, /dashboards\.view/);
  assert.match(metrics, /\.eq\("workspace_id",workspace\.id\)/);
  assert.match(metrics, /workflow_runs/);
});

test("workspace switching validates identifiers and relies on the user's RLS-scoped membership", () => {
  assert.match(workspaces, /getOrCreateDefaultWorkspace/);
  assert.match(workspaces, /from\("workspaces"\)/);
  assert.match(switchRoute, /uuidPattern\.test\(workspaceId\)/);
  assert.match(switchRoute, /origin!==new URL\(request\.url\)\.origin/);
  assert.match(switchRoute, /from\("workspaces"\).*eq\("id",workspaceId\)/s);
  assert.match(switchRoute, /aivanta_active_workspace/);
});

test("workflow creation is size-limited, permission-checked and draft-only", () => {
  assert.match(workflowCollection, /maxWorkflowPayloadBytes/);
  assert.match(workflowCollection, /request\.text\(\)/);
  assert.match(workflowCollection, /workflows\.create/);
  assert.match(workflowCollection, /body\.status !== "draft"/);
  assert.match(workflowCollection, /const status = "draft"/);
  assert.doesNotMatch(workflowCollection, /status === "active" &&/);
});

test("workflow mutation and execution routes enforce workspace authorization", () => {
  assert.match(workflowItem, /uuidPattern\.test\(workflowId\)/);
  assert.match(workflowItem, /hasWorkspacePermission/);
  assert.match(workflowItem, /workflows\.execute/);
  assert.match(workflowItem, /workflows\.edit/);
  assert.match(workflowRuns, /hasWorkspacePermission/);
  assert.match(workflowRuns, /workflows\.execute/);
  assert.match(dispatch, /hasWorkspacePermission/);
  assert.match(dispatch, /workflows\.execute/);
  assert.match(executionStatus, /\.eq\("workspace_id", workflow\.workspace_id\)/);
  assert.match(executionStatus, /from\("workflows"\)/);
});
