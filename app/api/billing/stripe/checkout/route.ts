import Stripe from "stripe";
import {getOrCreateDefaultWorkspace,getWorkspaceRole,canManageWorkspaceBilling} from "@/lib/supabase/workspace";
import {NextResponse} from "next/server";
import {createClient} from "@/lib/supabase/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {createPaymentReference,getPaidPlan} from "@/lib/billing/paystack";
export const runtime="nodejs";
export const dynamic="force-dynamic";
function priceEnv(slug:string){return "AIVANTA_STRIPE_PRICE_"+slug.toUpperCase().replaceAll("-","_");}
export async function POST(request:Request){
 try{
  const client=await createClient(),{data:{user}}=await client.auth.getUser();
  if(!user)return NextResponse.json({error:"Authentication required."},{status:401});
  const body=await request.json() as {plan?:unknown},plan=getPaidPlan(body.plan);
  if(!plan)return NextResponse.json({error:"This plan is not configured for checkout."},{status:400});
  const secret=process.env.STRIPE_SECRET_KEY;
  if(!secret)return NextResponse.json({error:"Stripe is not configured for this environment."},{status:503});
  if(!user.email)return NextResponse.json({error:"Account email is required."},{status:400});
  const priceId=process.env[priceEnv(plan.slug)];
  if(!priceId)return NextResponse.json({error:"Stripe price is not configured for this plan."},{status:503});
  const stripe=new Stripe(secret),price=await stripe.prices.retrieve(priceId);
  if(!price.active||price.currency.toUpperCase()!==plan.currency||price.unit_amount!==plan.amountMinor||price.type!=="one_time")
   return NextResponse.json({error:"Stripe price does not match the approved Aivanta plan price."},{status:409});
  const workspace=await getOrCreateDefaultWorkspace(client);
  const role=await getWorkspaceRole(client,workspace.id,user.id);
  if(!canManageWorkspaceBilling(role))return NextResponse.json({error:"Workspace owner or admin access required for billing changes."},{status:403});
  const reference=createPaymentReference(),admin=createAdminClient();
  const {data:payment,error:insertError}=await admin.from("billing_payments").insert({
   workspace_id:workspace.id,user_id:user.id,provider:"stripe",reference,plan_slug:plan.slug,
   amount_minor:plan.amountMinor,currency:plan.currency,status:"pending"
  }).select("id").single();
  if(insertError||!payment)throw insertError??new Error("Payment attempt could not be created.");
  const origin=new URL(request.url).origin;
  const session=await stripe.checkout.sessions.create({
   mode:"payment",customer_email:user.email,client_reference_id:reference,
   line_items:[{price:priceId,quantity:1}],
   success_url:origin+"/dashboard/billing?stripe_session_id={CHECKOUT_SESSION_ID}",
   cancel_url:origin+"/dashboard/billing?checkout=canceled",
   metadata:{payment_id:payment.id,workspace_id:workspace.id,user_id:user.id,reference,plan_slug:plan.slug}
  });
  const {error:updateError}=await admin.from("billing_payments").update({authorization_url:session.url,provider_transaction_ref:session.id,updated_at:new Date().toISOString()}).eq("id",payment.id);
  if(updateError)throw updateError;
  return NextResponse.json({url:session.url,reference},{headers:{"Cache-Control":"private,no-store"}});
 }catch(error){console.error("Stripe checkout initialization failed:",error);return NextResponse.json({error:"Could not start Stripe checkout."},{status:503});}
}
