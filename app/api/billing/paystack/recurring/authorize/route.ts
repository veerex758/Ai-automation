import {NextResponse} from "next/server";
import {createClient} from "@/lib/supabase/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {getOrCreateDefaultWorkspace,getWorkspaceRole,canManageWorkspaceBilling} from "@/lib/supabase/workspace";
import {createPaymentReference,getPaidPlan} from "@/lib/billing/paystack";
import { enforceDistributedRateLimit } from "@/lib/security/distributed-rate-limit";
export const runtime="nodejs";
const CONSENT_TERMS_VERSION="rexnora-recurring-v1";
function privateJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export async function POST(request:Request){
  const origin=request.headers.get("origin"),referer=request.headers.get("referer");
  let sourceOrigin:string|null=origin;
  if(!sourceOrigin&&referer){try{sourceOrigin=new URL(referer).origin;}catch{sourceOrigin=null;}}
  if(sourceOrigin!==new URL(request.url).origin)return privateJson({error:"Invalid origin."},{status:403});

 try{
  const supabase=await createClient(),{data:{user}}=await supabase.auth.getUser();
  if(!user)return privateJson({error:"Authentication required."},{status:401});
  if(!user.email)return privateJson({error:"Account email is required."},{status:400});
  const contentLength=Number(request.headers.get("content-length")??"0");
  if(contentLength>4096||new TextEncoder().encode(await request.clone().text()).byteLength>4096)return privateJson({error:"Billing request exceeds 4 KiB."},{status:413});
  let body:{plan?:unknown;consent?:unknown};
  try{body=await request.json() as {plan?:unknown;consent?:unknown};}catch{return privateJson({error:"Invalid request body."},{status:400});}
  const plan=getPaidPlan(body.plan);
  if(!plan)return privateJson({error:"Plan is not configured."},{status:400});
  if(body.consent!==true)return privateJson({error:"Explicit recurring-payment consent is required."},{status:400});
  const secret=process.env.PAYSTACK_SECRET_KEY;
  if(!secret)return privateJson({error:"Paystack is not configured."},{status:503});
  const workspace=await getOrCreateDefaultWorkspace(supabase),role=await getWorkspaceRole(supabase,workspace.id,user.id);
  if(!canManageWorkspaceBilling(role))return privateJson({error:"Workspace billing permission required."},{status:403});
  const limited=await enforceDistributedRateLimit(request,{
   scope:"paystack-recurring-authorize",windowMs:60*60_000,ipLimit:5,userId:user.id,userLimit:3,
   workspaceId:workspace.id,workspaceLimit:5,
  });
  if(limited)return limited;
  const admin=createAdminClient(),reference=createPaymentReference();
  const {data:consent,error:consentError}=await admin.from("billing_recurring_consents").insert({
   workspace_id:workspace.id,user_id:user.id,provider:"paystack",plan_slug:plan.slug,
   amount_minor:plan.amountMinor,currency:plan.currency,interval:plan.interval,
   terms_version:CONSENT_TERMS_VERSION,status:"pending"
  }).select("id").single();
  if(consentError)throw consentError;
  const {data:payment,error:insertError}=await admin.from("billing_payments").insert({
   workspace_id:workspace.id,user_id:user.id,provider:"paystack",reference,plan_slug:plan.slug,
   amount_minor:plan.amountMinor,currency:plan.currency,status:"pending",recurring_setup:true,
   recurring_consent_id:consent.id
  }).select("id").single();
  if(insertError){
   await admin.from("billing_recurring_consents").update({status:"failed",updated_at:new Date().toISOString()}).eq("id",consent.id);
   throw insertError;
  }
  const response=await fetch("https://api.paystack.co/transaction/initialize",{
   method:"POST",headers:{Authorization:"Bearer "+secret,"Content-Type":"application/json"},
   body:JSON.stringify({
    email:user.email,amount:plan.amountMinor,currency:plan.currency,reference,
    callback_url:new URL("/dashboard/billing/verify",request.url).toString(),
    metadata:{workspace_id:workspace.id,user_id:user.id,plan_slug:plan.slug,plan_key:plan.planKey,
     interval:plan.interval,recurring_setup:true,payment_id:payment.id,recurring_consent_id:consent.id}
   }),cache:"no-store",signal:AbortSignal.timeout(15000)
  });
  const result=await response.json();
  if(!response.ok||result.status!==true||!result.data?.authorization_url){
   await Promise.all([
    admin.from("billing_payments").update({status:"failed",updated_at:new Date().toISOString()}).eq("id",payment.id),
    admin.from("billing_recurring_consents").update({status:"failed",updated_at:new Date().toISOString()}).eq("id",consent.id)
   ]);
   return privateJson({error:"Paystack could not initialize the recurring authorization."},{status:502});
  }
  const {error:saveError}=await admin.from("billing_payments").update({
   authorization_url:result.data.authorization_url,access_code:result.data.access_code
  }).eq("id",payment.id);
  if(saveError)throw saveError;
  return privateJson({authorizationUrl:result.data.authorization_url,reference,plan:plan.slug,recurring:true},{headers:{"Cache-Control":"private,no-store"}});
 }catch(error){
  console.error("Paystack recurring authorization setup failed:",error);
  return privateJson({error:"Could not start recurring authorization."},{status:503});
 }
}
