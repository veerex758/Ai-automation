import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createRealEstateServiceClient } from "@/lib/real-estate/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
import { hasWorkspacePermission } from "@/lib/supabase/permissions";

export const dynamic="force-dynamic";
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const headers={"Cache-Control":"private, no-store"};
type Context={params:Promise<{decisionId:string}>};

export async function POST(request:NextRequest,context:Context) {
  try {
    const {decisionId}=await context.params;
    if(!uuid.test(decisionId))return NextResponse.json({error:"Invalid decision ID."},{status:400,headers});
    const supabase=await createClient();
    const {data:{user},error:authError}=await supabase.auth.getUser();
    if(authError||!user)return NextResponse.json({error:"Authentication required."},{status:401,headers});
    const workspace=await getOrCreateDefaultWorkspace(supabase);
    if(!(await hasWorkspacePermission(supabase,workspace.id,user.id,"workflows.execute")))return NextResponse.json({error:"Workspace workflows.execute permission required to resolve a decision."},{status:403,headers});
    const raw=await request.text();
    if(Buffer.byteLength(raw,"utf8")>1000)return NextResponse.json({error:"Decision input is too large."},{status:413,headers});
    let body:unknown;try{body=JSON.parse(raw)}catch{return NextResponse.json({error:"Request body must be valid JSON."},{status:400,headers});}
    if(!body||typeof body!=="object"||Array.isArray(body))return NextResponse.json({error:"Decision must be an object."},{status:400,headers});
    const choice=(body as Record<string,unknown>).decision;
    if(choice!=="approved"&&choice!=="rejected")return NextResponse.json({error:"Choose approve or reject."},{status:400,headers});
    const {data:existing,error:lookupError}=await supabase.from("real_estate_playbook_decisions")
      .select("id,workspace_id,workflow_id,status,expires_at")
      .eq("id",decisionId).eq("workspace_id",workspace.id).maybeSingle();
    if(lookupError)throw lookupError;
    if(!existing)return NextResponse.json({error:"Decision not found in this workspace."},{status:404,headers});
    if(existing.status!=="pending")return NextResponse.json({error:"This decision is no longer pending.",status:existing.status},{status:409,headers});
    if(new Date(existing.expires_at).getTime()<=Date.now())return NextResponse.json({error:"This decision has expired.",status:"expired"},{status:409,headers});
    const service=createRealEstateServiceClient();
    const {data,error}=await service.rpc("resolve_real_estate_playbook_decision",{
      p_decision_id:decisionId,p_actor_user_id:user.id,p_decision:choice,
    });
    if(error)throw error;
    const resolved=Array.isArray(data)?data[0]:data;
    if(!resolved||resolved.result_status!=="approved"&&resolved.result_status!=="rejected")return NextResponse.json({error:"The decision could not be resolved because the Playbook version or enquiry changed.",status:resolved?.result_status??"invalidated"},{status:409,headers});
    return NextResponse.json({success:true,status:resolved.result_status,decisionId},{headers});
  } catch(error) {
    console.error("Playbook decision resolution failed",error);
    return NextResponse.json({error:"Could not resolve this decision."},{status:500,headers});
  }
}
