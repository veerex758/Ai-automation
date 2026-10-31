import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";

export type NodeWorkspaceAccess =
  | {
      ok: true;
      supabase: Awaited<ReturnType<typeof createClient>>;
      user: { id: string };
      workspaceId: string;
      role: "owner" | "admin" | "member";
    }
  | {
      ok: false;
      status: 401 | 403;
      error: string;
    };

/** Resolve identity and the default workspace from the signed-in server session. */
export async function resolveNodeWorkspaceAccess(): Promise<NodeWorkspaceAccess> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return { ok: false, status: 401, error: "Authentication required." };
  }

  const workspace = await getOrCreateDefaultWorkspace(supabase);
  const { data: membership, error: membershipError } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspace.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (membershipError) throw membershipError;
  if (!membership || !["owner", "admin", "member"].includes(membership.role)) {
    return { ok: false, status: 403, error: "Workspace access required." };
  }

  return {
    ok: true,
    supabase,
    user: { id: user.id },
    workspaceId: workspace.id,
    role: membership.role,
  };
}

export function canManageNodeInstallations(role: NodeWorkspaceAccess extends infer T
  ? T extends { ok: true; role: infer R } ? R : never
  : never): boolean {
  return role === "owner" || role === "admin";
}
