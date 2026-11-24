import Stripe from "stripe";
import { createHash } from "node:crypto";
import {NextResponse} from "next/server";
import {createAdminClient} from "@/lib/supabase/admin";
export const runtime="nodejs";

function getSubscriptionPeriod(subscription: Stripe.Subscription) {
 const item=subscription.items.data[0];
 if(!item)throw new Error("Stripe subscription has no billing item.");
 return {
  currentPeriodStart:new Date(item.current_period_start*1000).toISOString(),
  currentPeriodEnd:new Date(item.current_period_end*1000).toISOString()
 };
}

function getInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
 const parent=invoice.parent;
 if(!parent||parent.type!=="subscription_details"||!parent.subscription_details)return null;
 const subscription=parent.subscription_details.subscription;
 return typeof subscription==="string"?subscription:subscription.id;
}
function privateJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export async function POST(request:Request){
 const secret=process.env.STRIPE_SECRET_KEY,signing=process.env.STRIPE_SUBSCRIPTION_WEBHOOK_SECRET;
 if(!secret||!signing)return privateJson({error:"Recurring Stripe webhook is not configured."},{status:503});
 const raw=await request.text();if(new TextEncoder().encode(raw).byteLength>256*1024)return privateJson({error:"Payload too large."},{status:413});
 const stripe=new Stripe(secret);let event:Stripe.Event;
 try{const sig=request.headers.get("stripe-signature");if(!sig)throw new Error();event=stripe.webhooks.constructEvent(raw,sig,signing);}catch{return privateJson({error:"Invalid Stripe signature."},{status:401});}
 const supported=["checkout.session.completed","invoice.paid","invoice.payment_failed","customer.subscription.deleted","customer.subscription.updated"];
 if(!supported.includes(event.type))return privateJson({received:true});
 const admin=createAdminClient();
 let claimToken:string|null=null;
 try{
  const payloadHash=createHash("sha256").update(raw).digest("hex");
  const {data:claimRows,error:claimError}=await admin.rpc("claim_billing_webhook_event",{
   p_provider:"stripe",p_event_key:event.id,p_event_type:event.type,p_payload_hash:payloadHash,
   p_lease_seconds:900
  });
  if(claimError)throw claimError;
  const claim=Array.isArray(claimRows)?claimRows[0]:claimRows;
  if(!claim||typeof claim!=="object")throw new Error("STRIPE_WEBHOOK_CLAIM_INVALID");
  const claimRecord=claim as Record<string,unknown>;
  if(claimRecord.reason==="payload_mismatch"||claimRecord.reason==="event_key_conflict")
   return privateJson({error:"Webhook event key conflicts with its stored payload."},{status:409});
  if(claimRecord.claimed!==true||typeof claimRecord.claim_token!=="string"){
   if(claimRecord.reason==="in_progress"||claimRecord.reason==="completed")
    return privateJson({received:true,duplicate:true});
   throw new Error("STRIPE_WEBHOOK_CLAIM_UNAVAILABLE");
  }
  claimToken=claimRecord.claim_token;
  if(event.type==="checkout.session.completed"){
   const session=event.data.object as Stripe.Checkout.Session;
   if(session.mode==="subscription"&&typeof session.subscription==="string"&&session.metadata?.workspace_id&&session.metadata.plan_key){
    const subscription=await stripe.subscriptions.retrieve(session.subscription);
    const workspaceId=session.metadata.workspace_id,planKey=session.metadata.plan_key;
    const period=getSubscriptionPeriod(subscription);
    const {error}=await admin.from("workspace_subscriptions").upsert({workspace_id:workspaceId,plan_key:planKey,status:subscription.status==="active"?"active":subscription.status,billing_provider:"stripe",provider_subscription_id:subscription.id,provider_customer_id:String(subscription.customer),current_period_start:period.currentPeriodStart,current_period_end:period.currentPeriodEnd,cancel_at_period_end:subscription.cancel_at_period_end,auto_renew:!subscription.cancel_at_period_end,recurring_interval:subscription.items.data[0]?.price.recurring?.interval==="year"?"year":"month",updated_at:new Date().toISOString()},{onConflict:"workspace_id"});
    if(error)throw error;
    const consentId=session.metadata.recurring_consent_id??subscription.metadata.recurring_consent_id;
    if(consentId){
     const {error:consentError}=await admin.from("billing_recurring_consents").update({status:"active",updated_at:new Date().toISOString()}).eq("id",consentId).eq("workspace_id",workspaceId).eq("provider","stripe");
     if(consentError)throw consentError;
    }
   }
  }else if(event.type==="invoice.paid"){
   const invoice=event.data.object as Stripe.Invoice;
   const subscriptionId=getInvoiceSubscriptionId(invoice);
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
   const invoice=event.data.object as Stripe.Invoice,subscriptionId=getInvoiceSubscriptionId(invoice);
   if(subscriptionId){const subscription=await stripe.subscriptions.retrieve(subscriptionId);const workspaceId=subscription.metadata.workspace_id;if(workspaceId){const {error}=await admin.from("workspace_subscriptions").update({status:"past_due",grace_until:new Date(Date.now()+7*86400000).toISOString(),updated_at:new Date().toISOString()}).eq("workspace_id",workspaceId).eq("provider_subscription_id",subscriptionId);if(error)throw error;}}
  }else{
   const subscription=event.data.object as Stripe.Subscription,workspaceId=subscription.metadata.workspace_id;
   if(workspaceId){const period=getSubscriptionPeriod(subscription);const patch={status:event.type==="customer.subscription.deleted"?"canceled":subscription.status,cancel_at_period_end:subscription.cancel_at_period_end,auto_renew:!subscription.cancel_at_period_end,current_period_start:period.currentPeriodStart,current_period_end:period.currentPeriodEnd,updated_at:new Date().toISOString()};const {error}=await admin.from("workspace_subscriptions").update(patch).eq("workspace_id",workspaceId).eq("provider_subscription_id",subscription.id);if(error)throw error;
    if(subscription.cancel_at_period_end||event.type==="customer.subscription.deleted"){
     const consentId=subscription.metadata.recurring_consent_id;
     if(consentId){
      const {error:consentError}=await admin.from("billing_recurring_consents").update({status:"revoked",revoked_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",consentId).eq("workspace_id",workspaceId).eq("provider","stripe");
      if(consentError)throw consentError;
     }
    }
   }
  }
  const {data:completed,error:completeError}=await admin.rpc("complete_billing_webhook_event",{
   p_provider:"stripe",p_event_key:event.id,p_claim_token:claimToken
  });
  if(completeError||completed!==true)throw completeError??new Error("STRIPE_WEBHOOK_CLAIM_LOST");
  return privateJson({received:true});
 }catch(error){
  if(claimToken){
   const {error:releaseError}=await admin.rpc("release_billing_webhook_event",{
    p_provider:"stripe",p_event_key:event.id,p_claim_token:claimToken,p_error_code:"PROCESSING_FAILED"
   });
   if(releaseError)console.error("Stripe webhook claim release failed.");
  }
  console.error("Stripe subscription webhook processing failed:",error);
  return privateJson({error:"Recurring Stripe event processing failed."},{status:503});
 }
}
