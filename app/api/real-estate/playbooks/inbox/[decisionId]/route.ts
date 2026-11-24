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
    if(Buffer.byteLength(raw,"utf8")>4000)return NextResponse.json({error:"Decision input is too large."},{status:413,headers});
    let body:unknown;try{body=JSON.parse(raw)}catch{return NextResponse.json({error:"Request body must be valid JSON."},{status:400,headers});}
    if(!body||typeof body!=="object"||Array.isArray(body))return NextResponse.json({error:"Decision must be an object."},{status:400,headers});
    const payload=body as Record<string,unknown>;
    const choice=payload.decision;
    if(choice!=="approved"&&choice!=="rejected")return NextResponse.json({error:"Choose approve or reject."},{status:400,headers});
    const rawCorrections=payload.corrections??{};
    if(!rawCorrections||typeof rawCorrections!=="object"||Array.isArray(rawCorrections))return NextResponse.json({error:"Corrections must be an object."},{status:400,headers});
    const corrections:Record<string,string|number>={};
    const allowed=new Set(["transaction_type","property_type","preferred_location","budget_min","budget_max","timeframe","readiness","main_concern"]);
    for(const [key,value] of Object.entries(rawCorrections as Record<string,unknown>)){
      if(!allowed.has(key))return NextResponse.json({error:"Unsupported correction field."},{status:400,headers});
      if(key==="budget_min"||key==="budget_max"){
        if(typeof value!=="number"||!Number.isFinite(value)||value<0||value>999999999999.99)return NextResponse.json({error:"Budget corrections must be non-negative numbers."},{status:400,headers});
        corrections[key]=value;
      }else{
        if(typeof value!=="string"||value.trim().length<1||value.trim().length>(key==="main_concern"?500:key==="preferred_location"?200:64))return NextResponse.json({error:"Text corrections must be valid and within the field limit."},{status:400,headers});
        const normalized=value.trim();
        const choices:Record<string,string[]>={
          transaction_type:["buy","rent","invest","sell","unknown"],
          property_type:["apartment","house","land","commercial","other","unknown"],
          timeframe:["urgent","within_30_days","one_to_three_months","over_three_months","unknown"],
          readiness:["cash_ready","pre_approved","financing_needed","researching","unknown"],
        };
        if(choices[key]&&!choices[key].includes(normalized))return NextResponse.json({error:"Choose a valid option for "+key.replaceAll("_"," ")+"."},{status:400,headers});
        corrections[key]=normalized;
      }
    }
    const {data:existing,error:lookupError}=await supabase.from("real_estate_playbook_decisions")
      .select("id,workspace_id,workflow_id,decision_type,status,expires_at")
      .eq("id",decisionId).eq("workspace_id",workspace.id).maybeSingle();
    if(lookupError)throw lookupError;
    if(!existing)return NextResponse.json({error:"Decision not found in this workspace."},{status:404,headers});
    if(existing.status!=="pending")return NextResponse.json({error:"This decision is no longer pending.",status:existing.status},{status:409,headers});
    if(Object.keys(corrections).length>0&&(existing.decision_type!=="qualification_review"||choice!=="approved"))return NextResponse.json({error:"Corrections are available only when approving a qualification review."},{status:400,headers});
    if(new Date(existing.expires_at).getTime()<=Date.now())return NextResponse.json({error:"This decision has expired.",status:"expired"},{status:409,headers});
    const service=createRealEstateServiceClient();
    const {data,error}=await service.rpc("resolve_real_estate_playbook_decision",{
      p_decision_id:decisionId,p_actor_user_id:user.id,p_decision:choice,p_corrections:corrections,
    });
    if(error){
      if(error.code==="22023")return NextResponse.json({error:"The correction values are invalid. Check the selected options and budget range."},{status:400,headers});
      throw error;
    }
    const resolved=Array.isArray(data)?data[0]:data;
    if(!resolved||resolved.result_status!=="approved"&&resolved.result_status!=="rejected")return NextResponse.json({error:"The decision could not be resolved because the Playbook version or enquiry changed.",status:resolved?.result_status??"invalidated"},{status:409,headers});
    return NextResponse.json({success:true,status:resolved.result_status,decisionId},{headers});
  } catch(error) {
    console.error("Playbook decision resolution failed",error);
    return NextResponse.json({error:"Could not resolve this decision."},{status:500,headers});
  }
}
