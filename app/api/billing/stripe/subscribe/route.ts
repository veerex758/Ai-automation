import Stripe from "stripe";
import {NextResponse} from "next/server";
import {createClient} from "@/lib/supabase/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {getOrCreateDefaultWorkspace,getWorkspaceRole,canManageWorkspaceBilling} from "@/lib/supabase/workspace";
import {getPaidPlan} from "@/lib/billing/paystack";
import { enforceDistributedRateLimit } from "@/lib/security/distributed-rate-limit";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const CONSENT_TERMS_VERSION="rexnora-recurring-v1";
function stripePriceEnv(slug:string){return "AIVANTA_STRIPE_SUBSCRIPTION_PRICE_"+slug.toUpperCase().replaceAll("-","_");}
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

 let consentId:string|undefined;
 const admin=createAdminClient();
 try{
  const supabase=await createClient(),{data:{user}}=await supabase.auth.getUser();
  if(!user)return privateJson({error:"Authentication required."},{status:401});
  if(!user.email)return privateJson({error:"Account email is required."},{status:400});
  const contentLength=Number(request.headers.get("content-length")??"0");
  if(contentLength>4096||new TextEncoder().encode(await request.clone().text()).byteLength>4096)return privateJson({error:"Billing request exceeds 4 KiB."},{status:413});
  let body:{plan?:unknown;consent?:unknown};
  try{body=await request.json() as {plan?:unknown;consent?:unknown};}catch{return privateJson({error:"Invalid request body."},{status:400});}
  const plan=getPaidPlan(body.plan);
  if(!plan)return privateJson({error:"Unsupported subscription plan."},{status:400});
  if(body.consent!==true)return privateJson({error:"Explicit recurring-payment consent is required."},{status:400});
  const stripeSecret=process.env.STRIPE_SECRET_KEY;
  if(!stripeSecret)return privateJson({error:"Stripe is not configured."},{status:503});
  const priceId=process.env[stripePriceEnv(plan.slug)];
  if(!priceId)return privateJson({error:"Recurring Stripe price is not configured."},{status:503});
  const stripe=new Stripe(stripeSecret),price=await stripe.prices.retrieve(priceId);
  if(!price.active||price.currency.toUpperCase()!==plan.currency||price.unit_amount!==plan.amountMinor||price.type!=="recurring"||price.recurring?.interval!==plan.interval)
   return privateJson({error:"Stripe recurring price does not match the approved plan amount and interval."},{status:409});
  const workspace=await getOrCreateDefaultWorkspace(supabase),role=await getWorkspaceRole(supabase,workspace.id,user.id);
  if(!canManageWorkspaceBilling(role))return privateJson({error:"Workspace billing permission required."},{status:403});
  const limited=await enforceDistributedRateLimit(request,{
   scope:"stripe-subscription-checkout",windowMs:60*60_000,ipLimit:5,userId:user.id,userLimit:3,
   workspaceId:workspace.id,workspaceLimit:5,
  });
  if(limited)return limited;
  const {data:consent,error:consentError}=await admin.from("billing_recurring_consents").insert({
   workspace_id:workspace.id,user_id:user.id,provider:"stripe",plan_slug:plan.slug,
   amount_minor:plan.amountMinor,currency:plan.currency,interval:plan.interval,
   terms_version:CONSENT_TERMS_VERSION,status:"pending"
  }).select("id").single();
  if(consentError)throw consentError;
  consentId=consent.id;
  const {data:customerRecord,error:customerError}=await admin.from("workspace_billing_customers").select("stripe_customer_id").eq("workspace_id",workspace.id).maybeSingle();
  if(customerError)throw customerError;
  let customerId=customerRecord?.stripe_customer_id;
  if(customerId){try{const customer=await stripe.customers.retrieve(customerId);if(customer.deleted)customerId=undefined;}catch{customerId=undefined;}}
  if(!customerId){
   const customer=await stripe.customers.create({email:user.email,name:user.user_metadata?.full_name??undefined,metadata:{workspace_id:workspace.id,user_id:user.id}});
   customerId=customer.id;
   const {error:saveError}=await admin.from("workspace_billing_customers").upsert({workspace_id:workspace.id,stripe_customer_id:customerId,updated_at:new Date().toISOString()},{onConflict:"workspace_id"});
   if(saveError)throw saveError;
  }
  const origin=new URL(request.url).origin;
  const session=await stripe.checkout.sessions.create({
   mode:"subscription",customer:customerId,line_items:[{price:priceId,quantity:1}],allow_promotion_codes:false,
   success_url:origin+"/dashboard/billing?subscription=success&session_id={CHECKOUT_SESSION_ID}",
   cancel_url:origin+"/dashboard/billing?subscription=canceled",
   subscription_data:{metadata:{workspace_id:workspace.id,user_id:user.id,plan_key:plan.planKey,plan_slug:plan.slug,recurring_consent_id:consent.id}},
   metadata:{workspace_id:workspace.id,user_id:user.id,plan_key:plan.planKey,plan_slug:plan.slug,recurring_consent_id:consent.id}
  });
  if(!session.url)throw new Error("STRIPE_CHECKOUT_URL_MISSING");
  return privateJson({url:session.url},{headers:{"Cache-Control":"private,no-store"}});
 }catch(error){
  if(consentId)await admin.from("billing_recurring_consents").update({status:"failed",updated_at:new Date().toISOString()}).eq("id",consentId);
  console.error("Stripe subscription checkout failed:",error);
  return privateJson({error:"Could not start recurring Stripe checkout."},{status:503});
 }
}
