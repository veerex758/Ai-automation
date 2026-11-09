import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPaidPlan } from "@/lib/billing/paystack";

export const dynamic = "force-dynamic";
export async function GET() {
 const supabase=await createClient();
 const {data:{user},error}=await supabase.auth.getUser();
 if(error||!user)return NextResponse.json({error:"Authentication required."},{status:401,headers:{"Cache-Control":"private, no-store"}});
 const workspace=await getOrCreateDefaultWorkspace(supabase);
 const {data,error:entitlementError}=await supabase.rpc("get_workspace_entitlements",{p_workspace_id:workspace.id});
 if(entitlementError)return NextResponse.json({error:"Billing entitlements are not available yet. Apply the Phase 5 migration."},{status:503,headers:{"Cache-Control":"private, no-store"}});
 const {data:subscription}=await supabase.from("workspace_subscriptions").select("plan_key,status,current_period_start,current_period_end,cancel_at_period_end,billing_provider").eq("workspace_id",workspace.id).maybeSingle();
 const admin=createAdminClient();const {data:payments}=await admin.from("billing_payments").select("id,reference,plan_slug,amount_minor,currency,status,paid_at,created_at").eq("workspace_id",workspace.id).order("created_at",{ascending:false}).limit(20);
 return NextResponse.json({workspace_id:workspace.id,entitlements:{...data,billing:{...(data.billing??{}),checkout_enabled:Boolean(process.env.PAYSTACK_SECRET_KEY&&getPaidPlan("pro-monthly"))}},subscription:subscription??{plan_key:"free",status:"active",billing_provider:null},payments:payments??[],checkout_plan:getPaidPlan("pro-monthly")?{slug:"pro-monthly",amount_minor:getPaidPlan("pro-monthly")!.amountMinor,currency:getPaidPlan("pro-monthly")!.currency}:null,plans:[
 {key:"free",name:"Free",price:{monthly:0,annual:0},limits:{workflow_created:2,workflow_execution:300,ai_credit:25}},
 {key:"starter",name:"Starter",price:{monthly:9,annual:90},limits:{workflow_created:10,workflow_execution:2000,ai_credit:500}},
 {key:"pro",name:"Pro",price:{monthly:29,annual:290},limits:{workflow_created:50,workflow_execution:10000,ai_credit:2500}},
 {key:"business",name:"Business",price:{monthly:79,annual:790},limits:{workflow_created:200,workflow_execution:50000,ai_credit:15000}}
 ,{key:"enterprise",name:"Enterprise",price:{monthly:null,annual:null},limits:{workflow_created:null,workflow_execution:null,ai_credit:null}}],checkout_enabled:Boolean(process.env.PAYSTACK_SECRET_KEY&&getPaidPlan("pro-monthly"))},{headers:{"Cache-Control":"private, no-store"}});
}
