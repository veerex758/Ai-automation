import Stripe from "stripe";
import {NextResponse} from "next/server";
import {createAdminClient} from "@/lib/supabase/admin";
export const runtime="nodejs";
export async function POST(request:Request){
 const secret=process.env.STRIPE_SECRET_KEY,signing=process.env.STRIPE_SUBSCRIPTION_WEBHOOK_SECRET;
 if(!secret||!signing)return NextResponse.json({error:"Recurring Stripe webhook is not configured."},{status:503});
 const raw=await request.text();if(new TextEncoder().encode(raw).byteLength>256*1024)return NextResponse.json({error:"Payload too large."},{status:413});
 const stripe=new Stripe(secret);let event:Stripe.Event;
 try{const sig=request.headers.get("stripe-signature");if(!sig)throw new Error();event=stripe.webhooks.constructEvent(raw,sig,signing);}catch{return NextResponse.json({error:"Invalid Stripe signature."},{status:401});}
 const supported=["checkout.session.completed","invoice.paid","invoice.payment_failed","customer.subscription.deleted","customer.subscription.updated"];
 if(!supported.includes(event.type))return NextResponse.json({received:true});
 const admin=createAdminClient();
 try{
  const {error:ledgerError}=await admin.from("billing_recurring_events").insert({provider:"stripe",event_key:event.id,event_type:event.type,payload_hash:Buffer.from(raw).toString("base64").slice(0,64)});
  if(ledgerError&&ledgerError.code!=="23505")throw ledgerError;
  const {data:prior}=await admin.from("billing_recurring_events").select("processed_at").eq("event_key",event.id).maybeSingle();
  if(prior?.processed_at)return NextResponse.json({received:true,duplicate:true});
  if(event.type==="checkout.session.completed"){
   const session=event.data.object as Stripe.Checkout.Session;
   if(session.mode==="subscription"&&typeof session.subscription==="string"&&session.metadata?.workspace_id&&session.metadata.plan_key){
    const subscription=await stripe.subscriptions.retrieve(session.subscription);
    const workspaceId=session.metadata.workspace_id,planKey=session.metadata.plan_key;
    const start=new Date(subscription.current_period_start*1000).toISOString(),end=new Date(subscription.current_period_end*1000).toISOString();
    const {error}=await admin.from("workspace_subscriptions").upsert({workspace_id:workspaceId,plan_key:planKey,status:subscription.status==="active"?"active":subscription.status,billing_provider:"stripe",provider_subscription_id:subscription.id,provider_customer_id:String(subscription.customer),current_period_start:start,current_period_end:end,cancel_at_period_end:subscription.cancel_at_period_end,auto_renew:!subscription.cancel_at_period_end,recurring_interval:subscription.items.data[0]?.price.recurring?.interval==="year"?"year":"month",updated_at:new Date().toISOString()},{onConflict:"workspace_id"});
    if(error)throw error;
   }
  }else if(event.type==="invoice.paid"){
   const invoice=event.data.object as Stripe.Invoice;
   const subscriptionId=typeof invoice.subscription==="string"?invoice.subscription:null;
   if(subscriptionId){
    const subscription=await stripe.subscriptions.retrieve(subscriptionId),workspaceId=subscription.metadata.workspace_id,planKey=subscription.metadata.plan_key;
    if(workspaceId&&planKey&&invoice.amount_paid>0){
     const planSlug=planKey+"-"+(subscription.items.data[0]?.price.recurring?.interval==="year"?"annual":"monthly"),reference="stripe_"+invoice.id;
     const {data:existing,error:lookupError}=await admin.from("billing_payments").select("id").eq("reference",reference).maybeSingle();if(lookupError)throw lookupError;
     let paymentId=existing?.id;
     if(!paymentId){const {data:payment,error}=await admin.from("billing_payments").insert({workspace_id:workspaceId,user_id:subscription.metadata.user_id,provider:"stripe",reference,plan_slug:planSlug,amount_minor:invoice.amount_paid,currency:invoice.currency.toUpperCase(),status:"pending",provider_transaction_ref:invoice.id,recurring_invoice_id:invoice.id,recurring_cycle_start:new Date(invoice.period_start*1000).toISOString(),recurring_cycle_end:new Date(invoice.period_end*1000).toISOString()}).select("id").single();if(error)throw error;paymentId=payment.id;}
     const {error:settleError}=await admin.rpc("settle_workspace_payment",{p_payment_id:paymentId,p_provider:"stripe",p_provider_transaction_ref:invoice.id,p_provider_transaction_id:null,p_paid_at:new Date(invoice.status_transitions?.paid_at?invoice.status_transitions.paid_at*1000:Date.now()).toISOString()});if(settleError)throw settleError;
    }
   }
  }else if(event.type==="invoice.payment_failed"){
   const invoice=event.data.object as Stripe.Invoice,subscriptionId=typeof invoice.subscription==="string"?invoice.subscription:null;
   if(subscriptionId){const subscription=await stripe.subscriptions.retrieve(subscriptionId);const workspaceId=subscription.metadata.workspace_id;if(workspaceId){const {error}=await admin.from("workspace_subscriptions").update({status:"past_due",grace_until:new Date(Date.now()+7*86400000).toISOString(),updated_at:new Date().toISOString()}).eq("workspace_id",workspaceId).eq("provider_subscription_id",subscriptionId);if(error)throw error;}}
  }else{
   const subscription=event.data.object as Stripe.Subscription,workspaceId=subscription.metadata.workspace_id;
   if(workspaceId){const patch={status:event.type==="customer.subscription.deleted"?"canceled":subscription.status,cancel_at_period_end:subscription.cancel_at_period_end,auto_renew:!subscription.cancel_at_period_end,current_period_start:new Date(subscription.current_period_start*1000).toISOString(),current_period_end:new Date(subscription.current_period_end*1000).toISOString(),updated_at:new Date().toISOString()};const {error}=await admin.from("workspace_subscriptions").update(patch).eq("workspace_id",workspaceId).eq("provider_subscription_id",subscription.id);if(error)throw error;}
  }
  const {error:markError}=await admin.from("billing_recurring_events").update({processed_at:new Date().toISOString(),processing_error:null}).eq("event_key",event.id);if(markError)throw markError;
  return NextResponse.json({received:true});
 }catch(error){console.error("Stripe subscription webhook processing failed:",error);await admin.from("billing_recurring_events").update({processing_error:"processing_failed"}).eq("event_key",event.id);return NextResponse.json({error:"Recurring Stripe event processing failed."},{status:503});}
}
