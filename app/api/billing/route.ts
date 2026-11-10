import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPaidPlan } from "@/lib/billing/paystack";
export const dynamic = "force-dynamic";
const planCatalog = [
 { key:"free",name:"Free",price:{monthly:0,annual:0},limits:{workflow_created:2,workflow_execution:300,ai_credit:25},checkout:[] as string[] },
 { key:"starter",name:"Starter",price:{monthly:9,annual:90},limits:{workflow_created:10,workflow_execution:2000,ai_credit:500},checkout:["starter-monthly","starter-annual"] },
 { key:"pro",name:"Pro",price:{monthly:29,annual:290},limits:{workflow_created:50,workflow_execution:10000,ai_credit:2500},checkout:["pro-monthly","pro-annual"] },
 { key:"business",name:"Business",price:{monthly:79,annual:790},limits:{workflow_created:200,workflow_execution:50000,ai_credit:15000},checkout:["business-monthly","business-annual"] },
 { key:"enterprise",name:"Enterprise",price:{monthly:null,annual:null},limits:{workflow_created:null,workflow_execution:null,ai_credit:null},checkout:[] as string[] }
];
export async function GET() {
 const supabase=await createClient(),{data:{user},error}=await supabase.auth.getUser();
 if(error||!user)return NextResponse.json({error:"Authentication required."},{status:401,headers:{"Cache-Control":"private,no-store"}});
 const workspace=await getOrCreateDefaultWorkspace(supabase);
 const {data:entitlement,error:entitlementError}=await supabase.rpc("get_workspace_entitlements",{p_workspace_id:workspace.id});
 if(entitlementError)return NextResponse.json({error:"Billing entitlements are not available yet. Apply the Phase 5 migration."},{status:503,headers:{"Cache-Control":"private,no-store"}});
 const {data:subscription}=await supabase.from("workspace_subscriptions").select("plan_key,status,current_period_start,current_period_end,cancel_at_period_end,billing_provider").eq("workspace_id",workspace.id).maybeSingle();
 const admin=createAdminClient(),{data:payments}=await admin.from("billing_payments").select("id,reference,plan_slug,amount_minor,currency,status,paid_at,created_at").eq("workspace_id",workspace.id).order("created_at",{ascending:false}).limit(20);
 const configuredPlans=planCatalog.map(p=>({...p,checkout:p.checkout.map(slug=>{const plan=getPaidPlan(slug);return plan?{slug:plan.slug,amount_minor:plan.amountMinor,currency:plan.currency}:null}).filter(Boolean)}));
 return NextResponse.json({workspace_id:workspace.id,entitlements:{...entitlement,billing:{...(entitlement.billing??{}),checkout_enabled:Boolean(process.env.PAYSTACK_SECRET_KEY&&configuredPlans.some(p=>p.checkout.length))}},subscription:subscription??{plan_key:"free",status:"active",billing_provider:null},payments:payments??[],plans:configuredPlans},{headers:{"Cache-Control":"private,no-store"}});
}
