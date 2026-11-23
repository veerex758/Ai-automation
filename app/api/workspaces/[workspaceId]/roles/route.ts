import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { WORKSPACE_PERMISSIONS } from "@/lib/supabase/permissions";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
type Context = { params: Promise<{ workspaceId: string }> };
async function authorize(workspaceId: string) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { response: NextResponse.json({ error: "Authentication required." }, { status: 401, headers }) };
  const [{ data: workspace, error: we }, { data: member, error: me }] = await Promise.all([
    supabase.from("workspaces").select("id,owner_id").eq("id", workspaceId).maybeSingle(),
    supabase.from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle(),
  ]);
  if (we || me) return { response: NextResponse.json({ error: "Could not verify workspace access." }, { status: 503, headers }) };
  const role = workspace?.owner_id === user.id ? "owner" : member?.role;
  if (!workspace || !role || !["owner", "admin"].includes(role)) return { response: NextResponse.json({ error: "Workspace owner/admin access required." }, { status: 403, headers }) };
  return { user, role };
}
export async function GET(_request: Request, context: Context) {
  const { workspaceId } = await context.params;
  const access = await authorize(workspaceId);
  if ("response" in access) return access.response;
  const admin = createAdminClient();
  const { data, error } = await admin.from("workspace_custom_roles").select("id,name,description,permissions,created_at,updated_at").eq("workspace_id", workspaceId).order("name");
  if (error) return NextResponse.json({ error: "Could not load custom roles." }, { status: 503, headers });
  return NextResponse.json({ roles: data ?? [], permission_catalog: WORKSPACE_PERMISSIONS }, { headers });
}
export async function POST(request: Request, context: Context) {
  const { workspaceId } = await context.params;
  const access = await authorize(workspaceId);
  if ("response" in access) return access.response;
  try {
    const body = await request.json() as { name?: unknown; description?: unknown; permissions?: unknown };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    if (name.length < 2 || name.length > 48 || description.length > 240) return NextResponse.json({ error: "Role name must be 2–48 characters and description at most 240." }, { status: 400, headers });
    if (!body.permissions || typeof body.permissions !== "object" || Array.isArray(body.permissions)) return NextResponse.json({ error: "A permission map is required." }, { status: 400, headers });
    const input = body.permissions as Record<string, unknown>;
    if (Object.keys(input).some((key) => !WORKSPACE_PERMISSIONS.includes(key as typeof WORKSPACE_PERMISSIONS[number])) || Object.values(input).some((value) => typeof value !== "boolean")) {
      return NextResponse.json({ error: "The permission map contains unsupported keys or values." }, { status: 400, headers });
    }
    const permissions = Object.fromEntries(WORKSPACE_PERMISSIONS.map((key) => [key, input[key] === true]));
    const admin = createAdminClient();
    const { data, error } = await admin.from("workspace_custom_roles").insert({ workspace_id: workspaceId, name, description, permissions, created_by: access.user.id })
      .select("id,name,description,permissions,created_at,updated_at").single();
    if (error) throw error;
    return NextResponse.json({ role: data }, { status: 201, headers });
  } catch (error) {
    console.error("Custom workspace role create failed:", error);
    return NextResponse.json({ error: "Could not create custom role. Role names must be unique within the workspace." }, { status: 409, headers });
  }
}
export async function PATCH(request: Request, context: Context) {
  const { workspaceId } = await context.params;
  const access = await authorize(workspaceId);
  if ("response" in access) return access.response;
  try {
    const body = await request.json() as { id?: unknown; name?: unknown; description?: unknown; permissions?: unknown };
    if (typeof body.id !== "string") return NextResponse.json({ error: "Role id is required." }, { status: 400, headers });
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.name !== undefined) {
      if (typeof body.name !== "string" || body.name.trim().length < 2 || body.name.trim().length > 48) return NextResponse.json({ error: "Role name must be 2–48 characters." }, { status: 400, headers });
      update.name = body.name.trim();
    }
    if (body.description !== undefined) {
      if (typeof body.description !== "string" || body.description.length > 240) return NextResponse.json({ error: "Description is too long." }, { status: 400, headers });
      update.description = body.description.trim();
    }
    if (body.permissions !== undefined) {
      if (!body.permissions || typeof body.permissions !== "object" || Array.isArray(body.permissions)) return NextResponse.json({ error: "A permission map is required." }, { status: 400, headers });
      const input = body.permissions as Record<string, unknown>;
      if (Object.keys(input).some((key) => !WORKSPACE_PERMISSIONS.includes(key as typeof WORKSPACE_PERMISSIONS[number])) || Object.values(input).some((value) => typeof value !== "boolean")) return NextResponse.json({ error: "Unsupported permissions." }, { status: 400, headers });
      update.permissions = Object.fromEntries(WORKSPACE_PERMISSIONS.map((key) => [key, input[key] === true]));
    }
    const admin = createAdminClient();
    const { data, error } = await admin.from("workspace_custom_roles").update(update).eq("id", body.id).eq("workspace_id", workspaceId).select("id,name,description,permissions,updated_at").maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Custom role not found." }, { status: 404, headers });
    return NextResponse.json({ role: data }, { headers });
  } catch (error) {
    console.error("Custom workspace role update failed:", error);
    return NextResponse.json({ error: "Could not update custom role." }, { status: 409, headers });
  }
}
export async function DELETE(request: Request, context: Context) {
  const { workspaceId } = await context.params;
  const access = await authorize(workspaceId);
  if ("response" in access) return access.response;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Role id is required." }, { status: 400, headers });
  const admin = createAdminClient();
  const { data: assigned, error: checkError } = await admin.from("workspace_members").select("user_id").eq("workspace_id", workspaceId).eq("custom_role_id", id).limit(1);
  if (checkError) return NextResponse.json({ error: "Could not verify role assignments." }, { status: 503, headers });
  if (assigned?.length) return NextResponse.json({ error: "Reassign members before deleting this role." }, { status: 409, headers });
  const { error } = await admin.from("workspace_custom_roles").delete().eq("id", id).eq("workspace_id", workspaceId);
  if (error) return NextResponse.json({ error: "Could not delete custom role." }, { status: 503, headers });
  return NextResponse.json({ deleted: true }, { headers });
}
