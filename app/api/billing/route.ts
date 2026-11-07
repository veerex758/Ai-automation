import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";

export const dynamic = "force-dynamic";
export async function GET() {
 const supabase=await createClient();
 const {data:{user},error}=await supabase.auth.getUser();
 if(error||!user)return NextResponse.json({error:"Authentication required."},{status:401,headers:{"Cache-Control":"private, no-store"}});
 const workspace=await getOrCreateDefaultWorkspace(supabase);
 const {data,error:entitlementError}=await supabase.rpc("get_workspace_entitlements",{p_workspace_id:workspace.id});
 if(entitlementError)return NextResponse.json({error:"Billing entitlements are not available yet. Apply the Phase 5 migration."},{status:503,headers:{"Cache-Control":"private, no-store"}});
 const {data:subscription}=await supabase.from("workspace_subscriptions").select("plan_key,status,current_period_start,current_period_end,cancel_at_period_end,billing_provider").eq("workspace_id",workspace.id).maybeSingle();
 return NextResponse.json({workspace_id:workspace.id,entitlements:data,subscription:subscription??{plan_key:"free",status:"active",billing_provider:null},plans:[
 {key:"free",name:"Free",limits:{workflow_created:3,agent_run:25,ai_generation:25}},
 {key:"starter",name:"Starter",limits:{workflow_created:25,agent_run:500,ai_generation:500}},
 {key:"pro",name:"Pro",limits:{workflow_created:100,agent_run:2500,ai_generation:2500}},
 {key:"business",name:"Business",limits:{workflow_created:500,agent_run:15000,ai_generation:15000}}
 ],checkout_enabled:false},{headers:{"Cache-Control":"private, no-store"}});
}
