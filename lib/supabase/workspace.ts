import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export type WorkspaceSummary = {
  id: string;
  name: string;
};

/**
 * Resolve the signed-in user's default workspace through a transaction-scoped
 * database lock. This keeps concurrent requests from creating duplicate defaults
 * and repairs a missing owner-membership row idempotently.
 */
export async function getOrCreateDefaultWorkspace(
  supabase: SupabaseClient,
): Promise<WorkspaceSummary> {
  const cookieStore = await cookies();
  const activeWorkspaceId = cookieStore.get("aivanta_active_workspace")?.value;
  if (activeWorkspaceId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(activeWorkspaceId)) {
    const { data: activeWorkspace, error: activeError } = await supabase.from("workspaces")
      .select("id,name").eq("id",activeWorkspaceId).maybeSingle();
    if (activeError) throw activeError;
    if (activeWorkspace && typeof activeWorkspace.id === "string" && typeof activeWorkspace.name === "string") {
      return { id: activeWorkspace.id, name: activeWorkspace.name };
    }
  }

  const { data, error } = await supabase.rpc("get_or_create_default_workspace");

  if (error) throw error;

  const workspace = Array.isArray(data) ? data[0] : data;
  if (
    !workspace
    || typeof workspace !== "object"
    || !("id" in workspace)
    || !("name" in workspace)
    || typeof workspace.id !== "string"
    || typeof workspace.name !== "string"
  ) {
    throw new Error("Default workspace could not be resolved.");
  }

  return { id: workspace.id, name: workspace.name };
}

export async function getWorkspaceRole(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
): Promise<string | null> {
  const [{ data: workspace, error: workspaceError }, { data: membership, error: membershipError }] = await Promise.all([
    supabase.from("workspaces").select("owner_id").eq("id", workspaceId).maybeSingle(),
    supabase.from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle(),
  ]);
  if (workspaceError) throw workspaceError;
  if (membershipError) throw membershipError;
  if (!workspace) return null;
  if (workspace.owner_id === userId) return "owner";
  return membership?.role ?? null;
}

export function canManageWorkspaceBilling(role: string | null): boolean {
  return role === "owner" || role === "admin";
}
