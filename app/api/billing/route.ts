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
 return NextResponse.json({workspace_id:workspace.id,entitlements¶»§q«^