import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../supabase/migrations/20261114180000_aivanta_custom_roles_operational_alerts.sql", import.meta.url), "utf8");
const guardMigration = await readFile(new URL("../supabase/migrations/20261114190000_aivanta_custom_role_assignment_guard.sql", import.meta.url), "utf8");
const permissions = await readFile(new URL("../lib/supabase/permissions.ts", import.meta.url), "utf8");
const rolesApi = await readFile(new URL("../app/api/workspaces/[workspaceId]/roles/route.ts", import.meta.url), "utf8");
const assignmentApi = await readFile(new URL("../app/api/workspaces/[workspaceId]/roles/assign/route.ts", import.meta.url), "utf8");
const alertsApi = await readFile(new URL("../app/api/workspaces/[workspaceId]/alerts/route.ts", import.meta.url), "utf8");
const delivery = await readFile(new URL("../lib/operations/alert-delivery.ts", import.meta.url), "utf8");
const operationsCron = await readFile(new URL("../app/api/internal/operations/alerts/route.ts", import.meta.url), "utf8");
const dashboardApi = await readFile(new URL("../app/api/dashboards/route.ts", import.meta.url), "utf8");
const dispatchApi = await readFile(new URL("../app/api/workflows/[workflowId]/dispatch/route.ts", import.meta.url), "utf8");

test("custom roles are workspace-scoped and permission maps are server-owned", () => {
  assert.ok(migration.includes("workspace_custom_roles"));
  assert.ok(migration.includes("workspace_members"));
  assert.ok(migration.includes("revoke all on public.workspace_custom_roles from public, anon, authenticated"));
  assert.ok(migration.includes("grant all on public.workspace_custom_roles to service_role"));
  assert.ok(guardMigration.includes("custom role must belong to the same workspace"));
  assert.ok(guardMigration.includes("custom roles may only be assigned to regular members"));
  assert.ok(permissions.includes("WORKSPACE_PERMISSIONS"));
  assert.ok(permissions.includes("createAdminClient"));
});

test("custom role APIs validate permission keys and workspace membership", () => {
  assert.ok(rolesApi.includes("WORKSPACE_PERMISSIONS.includes"));
  assert.ok(rolesApi.includes(".eq(\"workspace_id\", workspaceId)"));
  assert.ok(assignmentApi.includes(".eq(\"workspace_id\", workspaceId)"));
  assert.ok(assignmentApi.includes("custom_role_id"));
  assert.ok(assignmentApi.includes('target.role === "admin"'));
});

test("granular permissions guard dashboard and workflow execution APIs", () => {
  assert.ok(dashboardApi.includes('"dashboards.view"'));
  assert.ok(dashboardApi.includes('"dashboards.manage"'));
  assert.ok(dispatchApi.includes('"workflows.execute"'));
});

test("external operational alerts are encrypted, filtered, deduplicated and logged", () => {
  assert.ok(migration.includes("workspace_alert_destinations"));
  assert.ok(migration.includes("workspace_alert_deliveries"));
  assert.ok(alertsApi.includes("encryptWorkspaceCredentials"));
  assert.ok(alertsApi.includes('"operations.manage"'));
  assert.ok(delivery.includes("decryptWorkspaceCredentials"));
  assert.ok(delivery.includes("DEDUPLICATED_15M"));
  assert.ok(delivery.includes("status: \"sent\""));
  assert.ok(delivery.includes("status: \"failed\""));
  assert.ok(operationsCron.includes('request.headers.get("authorization") !== "Bearer " + secret'));
});
