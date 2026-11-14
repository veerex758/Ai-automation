import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
type Context = { params: Promise<{ workspaceId: string }> };
export async function PATCH(request: Request, context: Context) {
  const { workspaceId } = await context.params;
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers });
  const [{ data: workspace, error: we }, { data: member, error: me }] = await Promise.all([
    supabase.from("workspaces").select("owner_id").eq("id", workspaceId).maybeSingle(),
    supabase.from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle(),
  ]);
  if (we || me) return NextResponse.json({ error: "Could not verify workspace access." }, { status: 503, headers });
  const role = workspace?.owner_id === user.id ? "owner" : member?.role;
  if (!workspace || !role || !["owner", "admin"].includes(role)) return NextResponse.json({ error: "Workspace owner/admin access required." }, { status: 403, headers });
  try {
    const body = await request.json() as { user_id?: unknown; custom_role_id?: unknown };
    if (typeof body.user_id !== "string" || (body.custom_role_id !== null && typeof body.custom_role_id !== "string")) return NextResponse.json({ error: "Member and custom role are required." }, { status: 400, headers });
    if (body.user_id === workspace.owner_id) return NextResponse.json({ error: "The workspace owner does not use a custom role." }, { status: 409, headers });
    const admin = createAdminClient();
    const { data: target, error: targetError } = await admin.from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", body.user_id).maybeSingle();
    if (targetError) throw targetError;
    if (!target || target.role === "admin") return NextResponse.json({ error: "Custom roles can only be assigned to workspace members, not administrators." }, { status: 409, headers });
    if (body.custom_role_id) {
      const { data: customRole, error: roleError } = await admin.from("workspace_custom_roles").select("id").eq("id", body.custom_role_id).eq("workspace_id", workspaceId).maybeSingle();
      if (roleError) throw roleError;
      if (!customRole) return NextResponse.json({ error: "Custom role does not belong to this workspace." }, { status: 404, headers });
    }
    const { error: updateError } = await admin.from("workspace_members").update({ custom_role_id: body.custom_role_id }).eq("workspace_id", workspaceId).eq("user_id", body.user_id);
    if (updateError) throw updateError;
    return NextResponse.json({ assigned: true }, { headers });
  } catch (error) {
    console.error("Custom role assignment failed:", error);
    return NextResponse.json({ error: "Could not assign custom role." }, { status: 503, headers });
  }
}
