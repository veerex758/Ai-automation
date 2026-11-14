import Stripe from "stripe";
import {NextResponse} from "next/server";
import {createClient} from "@/lib/supabase/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {getOrCreateDefaultWorkspace,getWorkspaceRole,canManageWorkspaceBilling} from "@/lib/supabase/workspace";
import {getPaidPlan} from "@/lib/billing/paystack";
export const runtime="nodejs";
export const dynamic="force-dynamic";
function stripePriceEnv(slug:string){return "AIVANTA_STRIPE_SUBSCRIPTION_PRICE_"+slug.toUpperCase().replaceAll("-","_");}
export async function POST(request:Request){
 try{
  const supabase=await createClient(),{data:{user}}=await supabase.auth.getUser();
  if(!user)return NextResponse.json({error:"Authentication required."},{status:401});
  if(!user.email)return NextResponse.json({error:"Account email is required."},{status:400});
  const body=await request.json() as {plan?:unknown},plan=getPaidPlan(body.plan);
  if(!plan)return NextResponse.json({error:"Unsupported subscription plan."},{status:400});
  const stripeSecret=process.env.STRIPE_SECRET_KEY;if(!stripeSecret)return NextResponse.json({error:"Stripe is not configured."},{status:503});
  const priceId=process.env[stripePriceEnv(plan.slug)];if(!priceId)return NextResponse.json({error:"Recurring Stripe price is not configured."},{status:503});
  const stripe=new Stripe(stripeSecret),price=await stripe.prices.retrieve(priceId);
  if(!price.active||price.currency.toUpperCase()!==plan.currency||price.unit_amount!==plan.amountMinor||price.type!=="recurring"||price.recurring?.interval!==plan.interval)
   return NextResponse.json({error:"Stripe recurring price does not match the approved plan amount and interval."},{status:409});
  const workspace=await getOrCreateDefaultWorkspace(supabase),role=await getWorkspaceRole(supabase,workspace.id,user.id);
  if(!canManageWorkspaceBilling(role))return NextResponse.json({error:"Workspace billing permission required."},{status:403});
  const admin=createAdminClient();
  const {data:customerRecord,error:customerError}=await admin.from("workspace_billing_customers").select("stripe_customer_id").eq("workspace_id",workspace.id).maybeSingle();
  if(customerError)throw customerError;
  let customerId=customerRecord?.stripe_customer_id;
  if(customerId){try{const c=await stripe.customers.retrieve(customerId);if(c.deleted)customerId=undefined;}catch{customerId=undefined;}}
  if(!customerId){const customer=await stripe.customers.create({email:user.email,name:user.user_metadata?.full_name??undefined,metadata:{workspace_id:workspace.id,user_id:user.id}});customerId=customer.id;
   const {error:saveError}=await admin.from("workspace_billing_customers").upsert({workspace_id:workspace.id,stripe_customer_id:customerId,updated_at:new Date().toISOString()},{onConflict:"workspace_id"});if(saveError)throw saveError;}
  const origin=new URL(request.url).origin;
  const session=await stripe.checkout.sessions.create({mode:"subscription",customer:customerId,
   line_items:[{price:priceId,quantity:1}],allow_promotion_codes:false,
   success_url:origin+"/dashboard/billing?subscription=success&session_id={CHECKOUT_SESSION_ID}",
   cancel_url:origin+"/dashboard/billing?subscription=canceled",
   subscription_data:{metadata:{workspace_id:workspace.id,user_id:user.id,plan_key:plan.planKey,plan_slug:plan.slug}},
   metadata:{workspace_id:workspace.id,user_id:user.id,plan_key:plan.planKey,plan_slug:plan.slug}});
  return NextResponse.json({url:session.url},{headers:{"Cache-Control":"private,no-store"}});
 }catch(error){console.error("Stripe subscription checkout failed:",error);return NextResponse.json({error:"Could not start recurring Stripe checkout."},{status:503});}
}
