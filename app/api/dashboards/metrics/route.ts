import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
export async function GET() {
  try {
    const supabase = await createClient();
    const {data:{user},error:authError} = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({error:"Authentication required."},{status:401,headers});
    const workspace = await getOrCreateDefaultWorkspace(supabase);
    const since = new Date(Date.now()-30*86400000).toISOString();
    const [workflows,runs,succeeded,failed,agents,integrations] = await Promise.all([
      supabase.from("workflows").select("id",{count:"exact",head:true}).eq("workspace_id",workspace.id),
      supabase.from("workflow_runs").select("id",{count:"exact",head:true}).eq("workspace_id",workspace.id).gte("created_at",since),
      supabase.from("workflow_runs").select("id",{count:"exact",head:true}).eq("workspace_id",workspace.id).gte("created_at",since).in("status",["succeeded","completed"]),
      supabase.from("workflow_runs").select("id",{count:"exact",head:true}).eq("workspace_id",workspace.id).gte("created_at",since).in("status",["failed","dead_letter"]),
      supabase.from("agents").select("id",{count:"exact",head:true}).eq("workspace_id",workspace.id),
      supabase.from("workspace_integrations").select("id",{count:"exact",head:true}).eq("workspace_id",workspace.id)
    ]);
    const problem = [workflows.error,runs.error,succeeded.error,failed.error,agents.error,integrations.error].find(Boolean);
    if (problem) throw problem;
    const total = runs.count ?? 0;
    return NextResponse.json({
      workspace_id:workspace.id,period_days:30,refreshed_at:new Date().toISOString(),
      metrics:{
        workflow_count:workflows.count ?? 0,
        execution_count:total,
        agent_count:agents.count ?? 0,
        success_rate:total ? Math.round((succeeded.count ?? 0)/total*100) : 0,
        failed_runs:failed.count ?? 0,
        integration_count:integrations.count ?? 0
      }
    },{headers});
  } catch (error) {
    console.error("Dashboard metrics failed:",error);
    return NextResponse.json({error:"Could not load workspace metrics."},{status:503,headers});
  }
}
