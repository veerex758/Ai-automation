import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
import { hasWorkspacePermission } from "@/lib/supabase/permissions";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const allowedMetrics = new Set(["workflow_count","execution_count","agent_count","success_rate","failed_runs","integration_count"]);
function validWidgets(value: unknown): value is Array<{id:string;type:string;title:string;metric:string}> {
  return Array.isArray(value) && value.length <= 12 && value.every((w) => w && typeof w === "object"
    && typeof w.id === "string" && /^[a-zA-Z0-9_-]{1,48}$/.test(w.id)
    && w.type === "metric" && typeof w.title === "string" && w.title.trim().length > 0 && w.title.length <= 60
    && typeof w.metric === "string" && allowedMetrics.has(w.metric));
}
async function access(permission: "dashboards.view" | "dashboards.manage" = "dashboards.view") {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { response: NextResponse.json({error:"Authentication required."},{status:401,headers}) };
  const workspace = await getOrCreateDefaultWorkspace(supabase);
  if (!(await hasWorkspacePermission(supabase, workspace.id, user.id, permission))) return { response: NextResponse.json({ error: "Workspace " + permission + " permission required." }, { status: 403, headers }) };
  return { supabase, user, workspace };
}
export async function GET() {
  try {
    const a = await access(); if ("response" in a) return a.response;
    const { data, error } = await a.supabase.from("workspace_dashboards")
      .select("id,name,description,layout,widgets,created_at,updated_at")
      .eq("workspace_id",a.workspace.id).order("updated_at",{ascending:false});
    if (error) throw error;
    return NextResponse.json({workspace:a.workspace,dashboards:data ?? []},{headers});
  } catch (error) {
    console.error("Dashboard list failed:",error);
    return NextResponse.json({error:"Could not load dashboards."},{status:503,headers});
  }
}
export async function POST(request: Request) {
  try {
    const a = await access("dashboards.manage"); if ("response" in a) return a.response;
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 16384) return NextResponse.json({error:"Dashboard payload too large."},{status:413,headers});
    let body: Record<string,unknown>;
    try { body = JSON.parse(raw); } catch { return NextResponse.json({error:"Invalid JSON."},{status:400,headers}); }
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const layout = body.layout === "one_column" || body.layout === "three_column" ? body.layout : "two_column";
    const widgets = body.widgets ?? [];
    if (name.length < 1 || name.length > 100 || description.length > 500 || !validWidgets(widgets))
      return NextResponse.json({error:"Provide a valid name, description and up to 12 supported metric widgets."},{status:400,headers});
    const { data, error } = await a.supabase.from("workspace_dashboards").insert({
      workspace_id:a.workspace.id,created_by:a.user.id,name,description,layout,widgets
    }).select("id,name,description,layout,widgets,created_at,updated_at").single();
    if (error) throw error;
    return NextResponse.json({dashboard:data},{status:201,headers});
  } catch (error) {
    console.error("Dashboard create failed:",error);
    return NextResponse.json({error:"Could not save dashboard."},{status:503,headers});
  }
}
