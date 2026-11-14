import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const allowedMetrics = new Set(["workflow_count","execution_count","agent_count","success_rate","failed_runs","integration_count"]);
function validWidgets(value: unknown): value is Array<{id:string;type:string;title:string;metric:string}> {
  return Array.isArray(value) && value.length <= 12 && value.every((w) => w && typeof w === "object"
    && typeof w.id === "string" && /^[a-zA-Z0-9_-]{1,48}$/.test(w.id)
    && w.type === "metric" && typeof w.title === "string" && w.title.trim().length > 0 && w.title.length <= 60
    && typeof w.metric === "string" && allowedMetrics.has(w.metric));
}
async function access() {
  const supabase = await createClient(); const {data:{user},error} = await supabase.auth.getUser();
  if (error || !user) return {response:NextResponse.json({error:"Authentication required."},{status:401,headers})};
  const workspace = await getOrCreateDefaultWorkspace(supabase);
  return {supabase,user,workspace};
}
export async function GET(_request:Request,context:{params:Promise<{dashboardId:string}>}) {
  try {
    const a = await access(); if ("response" in a) return a.response;
    const {dashboardId} = await context.params;
    const {data,error} = await a.supabase.from("workspace_dashboards")
      .select("id,name,description,layout,widgets,created_at,updated_at")
      .eq("id",dashboardId).eq("workspace_id",a.workspace.id).maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({error:"Dashboard not found."},{status:404,headers});
    return NextResponse.json({dashboard:data},{headers});
  } catch (error) {
    console.error("Dashboard read failed:",error);
    return NextResponse.json({error:"Could not load dashboard."},{status:503,headers});
  }
}
export async function PATCH(request:Request,context:{params:Promise<{dashboardId:string}>}) {
  try {
    const a = await access(); if ("response" in a) return a.response;
    const {dashboardId} = await context.params;
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 16384) return NextResponse.json({error:"Dashboard payload too large."},{status:413,headers});
    let body:Record<string,unknown>;
    try { body = JSON.parse(raw); } catch { return NextResponse.json({error:"Invalid JSON."},{status:400,headers}); }
    const patch:Record<string,unknown> = {};
    if (body.name !== undefined) {
      if (typeof body.name !== "string" || body.name.trim().length < 1 || body.name.trim().length > 100)
        return NextResponse.json({error:"Invalid dashboard name."},{status:400,headers});
      patch.name = body.name.trim();
    }
    if (body.description !== undefined) {
      if (typeof body.description !== "string" || body.description.length > 500)
        return NextResponse.json({error:"Invalid description."},{status:400,headers});
      patch.description = body.description.trim();
    }
    if (body.layout !== undefined) {
      if (!["one_column","two_column","three_column"].includes(String(body.layout)))
        return NextResponse.json({error:"Invalid layout."},{status:400,headers});
      patch.layout = body.layout;
    }
    if (body.widgets !== undefined) {
      if (!validWidgets(body.widgets)) return NextResponse.json({error:"Invalid widgets."},{status:400,headers});
      patch.widgets = body.widgets;
    }
    if (!Object.keys(patch).length) return NextResponse.json({error:"No valid changes supplied."},{status:400,headers});
    const {data,error} = await a.supabase.from("workspace_dashboards").update(patch)
      .eq("id",dashboardId).eq("workspace_id",a.workspace.id)
      .select("id,name,description,layout,widgets,created_at,updated_at").maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({error:"Dashboard not found or you do not own it."},{status:404,headers});
    return NextResponse.json({dashboard:data},{headers});
  } catch (error) {
    console.error("Dashboard update failed:",error);
    return NextResponse.json({error:"Could not update dashboard."},{status:503,headers});
  }
}
export async function DELETE(_request:Request,context:{params:Promise<{dashboardId:string}>}) {
  try {
    const a = await access(); if ("response" in a) return a.response;
    const {dashboardId} = await context.params;
    const {data,error} = await a.supabase.from("workspace_dashboards").delete()
      .eq("id",dashboardId).eq("workspace_id",a.workspace.id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({error:"Dashboard not found or you do not own it."},{status:404,headers});
    return NextResponse.json({deleted:true},{headers});
  } catch (error) {
    console.error("Dashboard delete failed:",error);
    return NextResponse.json({error:"Could not delete dashboard."},{status:503,headers});
  }
}
