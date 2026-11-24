import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
import { hasWorkspacePermission } from "@/lib/supabase/permissions";

export const dynamic = "force-dynamic";
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const headers={"Cache-Control":"private, no-store"};

export async function GET(request:NextRequest) {
  try {
    const supabase=await createClient();
    const {data:{user},error:authError}=await supabase.auth.getUser();
    if(authError||!user)return NextResponse.json({error:"Authentication required."},{status:401,headers});
    const workspace=await getOrCreateDefaultWorkspace(supabase);
    if(!(await hasWorkspacePermission(supabase,workspace.id,user.id,"workflows.view")))return NextResponse.json({error:"Workspace workflows.view permission required."},{status:403,headers});
    const workflowId=request.nextUrl.searchParams.get("workflowId");
    if(!workflowId||!uuid.test(workflowId))return NextResponse.json({error:"A valid Playbook ID is required."},{status:400,headers});
    const {data:workflow,error:workflowError}=await supabase.from("workflows").select("id")
      .eq("id",workflowId).eq("workspace_id",workspace.id).maybeSingle();
    if(workflowError)throw workflowError;
    if(!workflow)return NextResponse.json({error:"Playbook not found in this workspace."},{status:404,headers});
    const {data:decisions,error}=await supabase.from("real_estate_playbook_decisions")
      .select("id,lead_id,workflow_version,decision_type,step_id,node_id,operation_id,permission,status,reason,safe_details,requested_at,expires_at")
      .eq("workspace_id",workspace.id).eq("workflow_id",workflowId)
      .order("requested_at",{ascending:false}).limit(100);
    if(error)throw error;
    const ids=(decisions??[]).map(d=>d.lead_id);
    const {data:leads,error:leadError}=ids.length
      ? await supabase.from("real_estate_leads").select("id,full_name,source,lead_score,preferred_location").eq("workspace_id",workspace.id).in("id",ids)
      : {data:[],error:null};
    if(leadError)throw leadError;
    const names=new Map((leads??[]).map(lead=>[lead.id,lead]));
    return NextResponse.json({decisions:(decisions??[]).map(d=>({...d,lead:names.get(d.lead_id)??null})),pendingCount:(decisions??[]).filter(d=>d.status==="pending").length},{headers});
  } catch(error) {
    console.error("Playbook Decision Inbox failed",error);
    return NextResponse.json({error:"Could not load this Playbook's decisions."},{status:500,headers});
  }
}
