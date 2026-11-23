import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [dashboard, metrics, workspaces, switchRoute, workflowCollection, workflowItem, workflowRuns, dispatch, scheduleRoute, executionStatus, definitionRoute, webhookRoute, integrationRoute, sessionGuard, membersRoute, invitationsRoute, rolesRoute, securityRoute, assignRoleRoute, transferRoute, acceptInvitationRoute, permissions, agents, agentItem, agentRuns, realEstateDashboard, realEstateLeads, realEstateProperties, intakeForms, realEstateFollowups, realEstateMatches] = await Promise.all([
  read("../app/dashboard/page.tsx"),
  read("../app/api/dashboards/metrics/route.ts"),
  read("../app/api/workspaces/route.ts"),
  read("../app/api/workspaces/[workspaceId]/switch/route.ts"),
  read("../app/api/workflows/route.ts"),
  read("../app/api/workflows/[workflowId]/route.ts"),
  read("../app/api/workflows/[workflowId]/runs/route.ts"),
  read("../app/api/workflows/[workflowId]/dispatch/route.ts"),
  read("../app/api/workflows/[workflowId]/schedule/route.ts"),
  read("../app/api/workflows/[workflowId]/executions/[jobId]/route.ts"),
  read("../app/api/workflows/[workflowId]/definition/route.ts"),
  read("../app/api/workflows/[workflowId]/webhook/route.ts"),
  read("../app/api/integrations/workspace/route.ts"),
  read("../app/dashboard/session-expiry-guard.tsx"),
  read("../app/api/workspaces/[workspaceId]/members/route.ts"),
  read("../app/api/workspaces/[workspaceId]/invitations/route.ts"),
  read("../app/api/workspaces/[workspaceId]/roles/route.ts"),
  read("../app/api/workspaces/[workspaceId]/security/route.ts"),
  read("../app/api/workspaces/[workspaceId]/roles/assign/route.ts"),
  read("../app/api/workspaces/[workspaceId]/transfer/route.ts"),
  read("../app/api/workspaces/invitations/accept/route.ts"),
  read("../lib/supabase/permissions.ts"),
  read("../app/api/agents/route.ts"),
  read("../app/api/agents/[agentId]/route.ts"),
  read("../app/api/agents/[agentId]/runs/route.ts"),
  read("../app/api/real-estate/dashboard/route.ts"),
  read("../app/api/real-estate/leads/route.ts"),
  read("../app/api/real-estate/properties/route.ts"),
  read("../app/api/real-estate/intake-forms/route.ts"),
  read("../app/api/real-estate/followups/route.ts"),
  read("../app/api/real-estate/leads/[leadId]/matches/route.ts"),
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
  assert.match(metrics, /const completed =/);
  assert.match(metrics, /success_rate:completed/);
});

test("workspace switching validates identifiers and relies on the user's RLS-scoped membership", () => {
  assert.match(workspaces, /getOrCreateDefaultWorkspace/);
  assert.match(workspaces, /from\("workspaces"\)/);
  assert.match(switchRoute, /uuidPattern\.test\(workspaceId\)/);
  assert.match(switchRoute, /sourceOrigin!==new URL\(request\.url\)\.origin/);
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
  assert.match(dispatch, /Dispatch request exceeds 64 KiB/);
  assert.match(scheduleRoute, /workflows\.execute/);
  assert.match(scheduleRoute, /Schedule request exceeds 8 KiB/);
  assert.match(workflowRuns, /request\.clone\(\)\.text\(\)/);
  assert.match(webhookRoute, /Webhook provisioning request exceeds 1 KiB/);
  assert.match(executionStatus, /\.eq\("workspace_id", workflow\.workspace_id\)/);
  assert.match(executionStatus, /from\("workflows"\)/);
});

test("dashboard activity and workspace-specific management use live data", () => {
  assert.match(metrics, /recent_runs: recentRuns/);
  assert.match(dashboard, /recent_runs\.map/);
  assert.match(dashboard, /No workflow runs recorded in this workspace yet/);
  assert.match(permissions, /agents\.view/);
  assert.match(permissions, /agents\.manage/);
  assert.match(permissions, /real_estate\.view/);
  assert.match(permissions, /real_estate\.manage/);
  assert.match(permissions, /agents\.manage.*agents\.view/);
  assert.match(permissions, /real_estate\.manage.*real_estate\.view/);
  assert.match(agents, /hasWorkspacePermission/);
  assert.match(agents, /agents\.view/);
  assert.match(agents, /agents\.manage/);
  assert.match(agentItem, /hasWorkspacePermission/);
  assert.match(agentItem, /uuidPattern\.test\(agentId\)/);
  assert.match(agentRuns, /hasWorkspacePermission/);
  assert.match(agentRuns, /16 \* 1024/);
  assert.match(realEstateDashboard, /real_estate\.view/);
  assert.match(realEstateLeads, /real_estate\.view/);
  assert.match(realEstateLeads, /real_estate\.manage/);
  assert.match(realEstateProperties, /real_estate\.view/);
  assert.match(realEstateProperties, /real_estate\.manage/);
  assert.match(intakeForms, /real_estate\.view/);
  assert.match(intakeForms, /real_estate\.manage/);
  assert.match(realEstateFollowups, /Invalid follow-up status/);
  assert.match(realEstateMatches, /uuidPattern\.test\(leadId\)/);
});

test("workflow definitions, webhook provisioning and execution inspection enforce explicit permissions", () => {
  assert.match(definitionRoute, /hasWorkspacePermission/);
  assert.match(definitionRoute, /workflows\.view/);
  assert.match(definitionRoute, /workflows\.edit/);
  assert.match(definitionRoute, /maxDefinitionBytes/);
  assert.match(definitionRoute, /private, no-store/);
  assert.match(webhookRoute, /workflows\.execute/);
  assert.match(webhookRoute, /workflows\.edit/);
  assert.match(executionStatus, /workflows\.view/);
  assert.match(executionStatus, /workflows\.execute/);
  assert.match(integrationRoute, /integrations\.view/);
  assert.match(sessionGuard, /onAuthStateChange/);
  assert.match(sessionGuard, /SIGNED_OUT/);
});

test("workspace administration endpoints validate tenant identifiers and sensitive requests", () => {
  assert.match(membersRoute, /uuidPattern\.test\(workspaceId\)/);
  assert.match(membersRoute, /members\.manage/);
  assert.match(membersRoute, /Member update exceeds 4 KiB/);
  assert.match(invitationsRoute, /uuidPattern\.test\(workspaceId\)/);
  assert.match(invitationsRoute, /members\.manage/);
  assert.match(rolesRoute, /uuidPattern\.test\(workspaceId\)/);
  assert.match(rolesRoute, /Role configuration exceeds 8 KiB/);
  assert.match(rolesRoute, /WORKSPACE_PERMISSIONS/);
  assert.match(securityRoute, /uuidPattern\.test\(workspaceId\)/);
  assert.match(securityRoute, /Only the workspace owner/);
  assert.match(assignRoleRoute, /uuidPattern\.test\(workspaceId\)/);
  assert.match(assignRoleRoute, /uuidPattern\.test\(body\.user_id\)/);
  assert.match(transferRoute, /uuidPattern\.test\(workspaceId\)/);
  assert.match(transferRoute, /Invalid origin/);
  assert.match(transferRoute, /uuidPattern\.test\(body\.new_owner_id\)/);
  assert.match(acceptInvitationRoute, /user\.email_confirmed_at/);
  assert.match(acceptInvitationRoute, /sha256/);
  assert.match(acceptInvitationRoute, /Invitation acceptance request exceeds 4 KiB/);
  assert.match(acceptInvitationRoute, /sourceOrigin!==new URL\(request\.url\)\.origin/);
});
