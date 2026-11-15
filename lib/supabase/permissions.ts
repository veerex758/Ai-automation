import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

export const WORKSPACE_PERMISSIONS = [
  "workflows.view", "workflows.create", "workflows.edit", "workflows.delete", "workflows.execute",
  "integrations.view", "integrations.manage",
  "dashboards.view", "dashboards.manage",
  "members.view", "members.manage",
  "billing.view", "billing.manage",
  "operations.view", "operations.manage",
  "settings.manage",
] as const;
export type WorkspacePermission = typeof WORKSPACE_PERMISSIONS[number];
export type WorkspacePermissionMap = Partial<Record<WorkspacePermission, boolean>>;

export const DEFAULT_MEMBER_PERMISSIONS: WorkspacePermissionMap = {
  "workflows.view": true, "workflows.create": true, "workflows.edit": true,
  "workflows.execute": true, "integrations.view": true, "dashboards.view": true,
};

export async function getWorkspacePermissions(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
): Promise<{ role: string | null; customRoleId: string | null; permissions: WorkspacePermissionMap }> {
  const [{ data: workspace, error: workspaceError }, { data: member, error: memberError }] = await Promise.all([
    supabase.from("workspaces").select("owner_id").eq("id", workspaceId).maybeSingle(),
    supabase.from("workspace_members").select("role,custom_role_id").eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle(),
  ]);
  if (workspaceError) throw workspaceError;
  if (memberError) throw memberError;
  if (!workspace || (workspace.owner_id !== userId && !member)) {
    return { role: null, customRoleId: null, permissions: {} };
  }
  const role = workspace.owner_id === userId ? "owner" : member?.role ?? null;
  if (role === "owner" || role === "admin") {
    return { role, customRoleId: member?.custom_role_id ?? null, permissions: Object.fromEntries(WORKSPACE_PERMISSIONS.map((key) => [key, true])) as WorkspacePermissionMap };
  }
  if (member?.custom_role_id) {
    const admin = createAdminClient();
    const { data: customRole, error } = await admin.from("workspace_custom_roles")
      .select("permissions").eq("id", member.custom_role_id).eq("workspace_id", workspaceId).maybeSingle();
    if (error) throw error;
    const raw = customRole?.permissions && typeof customRole.permissions === "object" ? customRole.permissions as Record<string, unknown> : {};
    const permissions: WorkspacePermissionMap = {};
    for (const key of WORKSPACE_PERMISSIONS) permissions[key] = raw[key] === true;
    if (permissions["workflows.create"] || permissions["workflows.edit"] || permissions["workflows.delete"] || permissions["workflows.execute"]) permissions["workflows.view"] = true;
    if (permissions["integrations.manage"]) permissions["integrations.view"] = true;
    if (permissions["dashboards.manage"]) permissions["dashboards.view"] = true;
    if (permissions["members.manage"]) permissions["members.view"] = true;
    if (permissions["billing.manage"]) permissions["billing.view"] = true;
    if (permissions["operations.manage"]) permissions["operations.view"] = true;
    return { role, customRoleId: member.custom_role_id, permissions };
  }
  return { role, customRoleId: null, permissions: DEFAULT_MEMBER_PERMISSIONS };
}

export async function hasWorkspacePermission(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
  permission: WorkspacePermission,
): Promise<boolean> {
  const access = await getWorkspacePermissions(supabase, workspaceId, userId);
  return access.permissions[permission] === true;
}
