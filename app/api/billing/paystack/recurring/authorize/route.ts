import {NextResponse} from "next/server";
import {createClient} from "@/lib/supabase/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {getOrCreateDefaultWorkspace,getWorkspaceRole,canManageWorkspaceBilling} from "@/lib/supabase/workspace";
import {createPaymentReference,getPaidPlan} from "@/lib/billing/paystack";
export const runtime="nodejs";
export async function POST(request:Request){
 try{
  const supabase=await createClient(),{data:{user}}=await supabase.auth.getUser();if(!user)return NextResponse.json({error:"Authentication required."},{status:401});
  if(!user.email)return NextResponse.json({error:"Account email is required."},{status:400});
  const body=await request.json() as {plan?:unknown},plan=getPaidPlan(body.plan);if(!plan)return NextResponse.json({error:"Plan is not configured."},{status:400});
  const secret=process.env.PAYSTACK_SECRET_KEY;if(!secret)return NextResponse.json({error:"Paystack is not configured."},{status:503});
  const workspace=await getOrCreateDefaultWorkspace(supabase),role=await getWorkspaceRole(supabase,workspace.id,user.id);
  if(!canManageWorkspaceBilling(role))return NextResponse.json({error:"Workspace billing permission required."},{status:403});
  const admin=createAdminClient(),reference=createPaymentReference();
  const {data:payment,error:insertError}=await admin.from("billing_payments").insert({workspace_id:workspace.id,user_id:user.id,provider:"paystack",reference,plan_slug:plan.slug,amount_minor:plan.amountMinor,currency:plan.currency,status:"pending",recurring_setup:true}).select("id").single();
  if(insertError)throw insertError;
  const response=await fetch("https://api.paystack.co/transaction/initialize",{method:"POST",headers:{Authorization:"Bearer "+secret,"Content-Type":"application/json"},body:JSON.stringify({email:user.email,amount:plan.amountMinor,currency:plan.currency,reference,callback_url:new URL("/dashboard/billing/verify",request.url).toString(),metadata:{workspace_id:workspace.id,user_id:user.id,plan_slug:plan.slug,plan_key:plan.planKey,interval:plan.interval,recurring_setup:true,payment_id:payment.id}}),cache:"no-store"});
  const result=await response.json();if(!response.ok||result.status!==true||!result.data?.authorization_url){await admin.from("billing_payments").update({status:"failed"}).eq("id",payment.id);throw new Error("Authorization initialization failed.");}
  await admin.from("billing_payments").update({authorization_url:result.data.authorization_url,access_code:result.data.access_code}).eq("id",payment.id);
  return NextResponse.json({authorizationUrl:result.data.authorization_url,reference,plan:plan.slug,recurring:true},{headers:{"Cache-Control":"private,no-store"}});
 }catch(error){console.error("Paystack recurring authorization setup failed:",error);return NextResponse.json({error:"Could not start recurring authorization."},{status:503});}
}
