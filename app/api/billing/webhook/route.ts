import {NextResponse} from "next/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {isValidPaystackSignature,isVerifiedPayment} from "@/lib/billing/paystack";
import {encryptWebhookSecret} from "@/lib/webhooks/secret-crypto";

type PaystackChargeEvent={
 event?:string;
 data?:{
  reference?:unknown;status?:unknown;amount?:unknown;currency?:unknown;id?:unknown;paid_at?:string;
  authorization?:{authorization_code?:string;reusable?:boolean;customer_code?:string;card_type?:string;last4?:string;exp_month?:string;exp_year?:string};
  customer?:{email?:string};
 };
};
export const runtime="nodejs";
export async function POST(request:Request){
 const secret=process.env.PAYSTACK_SECRET_KEY;
 if(!secret)return NextResponse.json({error:"Webhook unavailable."},{status:503});
 const raw=await request.text();
 if(new TextEncoder().encode(raw).byteLength>256*1024)return NextResponse.json({error:"Payload too large."},{status:413});
 if(!isValidPaystackSignature(raw,request.headers.get("x-paystack-signature"),secret))return NextResponse.json({error:"Invalid signature."},{status:401});
 let event:PaystackChargeEvent;
 try{event=JSON.parse(raw) as PaystackChargeEvent;}catch{return NextResponse.json({error:"Invalid JSON."},{status:400});}
 if(!["charge.success","charge.failed"].includes(event.event??"")||typeof event.data?.reference!=="string")return NextResponse.json({received:true});
 try{
  const admin=createAdminClient(),now=new Date().toISOString();
  const {data:payment,error:paymentError}=await admin.from("billing_payments").select("*").eq("reference",event.data.reference).maybeSingle();
  if(paymentError)throw paymentError;
  if(!payment)return NextResponse.json({received:true});
  if(event.event==="charge.success"&&!isVerifiedPayment(event.data,{amountMinor:payment.amount_minor,currency:payment.currency}))
   return NextResponse.json({error:"Payment details mismatch."},{status:422});

  const eventKey=event.event+":"+payment.reference;
  const {error:insertError}=await admin.from("billing_webhook_events").insert({event_key:eventKey,event_type:event.event,reference:payment.reference});
  if(insertError&&insertError.code!=="23505")throw insertError;
  const {data:prior,error:priorError}=await admin.from("billing_webhook_events").select("processed_at").eq("event_key",eventKey).maybeSingle();
  if(priorError)throw priorError;
  if(prior?.processed_at)return NextResponse.json({received:true,duplicate:true});

  if(event.event==="charge.failed"){
   if(payment.status==="pending"){
    const {error}=await admin.from("billing_payments").update({status:"failed",updated_at:now}).eq("id",payment.id);
    if(error)throw error;
   }
   if(payment.recurring_setup&&payment.recurring_consent_id){
    const {error}=await admin.from("billing_recurring_consents").update({status:"failed",updated_at:now}).eq("id",payment.recurring_consent_id);
    if(error)throw error;
   }
   if(payment.recurring_job_id){
    const {error}=await admin.rpc("retry_paystack_recurring_renewal",{p_job_id:payment.recurring_job_id,p_error_code:"PAYSTACK_CHARGE_FAILED"});
    if(error)throw error;
    const {error:subscriptionError}=await admin.from("workspace_subscriptions").update({status:"past_due",grace_until:new Date(Date.now()+7*86400000).toISOString(),updated_at:now}).eq("workspace_id",payment.workspace_id).eq("billing_provider","paystack");
    if(subscriptionError)throw subscriptionError;
   }
   const {error:markError}=await admin.from("billing_webhook_events").update({processed_at:now}).eq("event_key",eventKey);
   if(markError)throw markError;
   return NextResponse.json({received:true});
  }

  if(payment.recurring_setup){
   const authorization=event.data.authorization;
   if(!authorization?.authorization_code||authorization.reusable!==true||!event.data.customer?.email)
    return NextResponse.json({error:"Reusable Paystack authorization was not returned."},{status:422});
   const encryptionKey=process.env.AIVANTA_CREDENTIALS_ENCRYPTION_KEY;
   if(!encryptionKey)return NextResponse.json({error:"Authorization encryption is not configured."},{status:503});
   const encrypted=encryptWebhookSecret(authorization.authorization_code,encryptionKey).toString("base64");
   const {error:customerError}=await admin.from("workspace_billing_customers").upsert({
    workspace_id:payment.workspace_id,paystack_customer_code:authorization.customer_code??null,
    paystack_authorization_code_enc:encrypted,
    paystack_authorization_meta:{reusable:true,card_type:authorization.card_type??null,last4:authorization.last4??null,
     exp_month:authorization.exp_month??null,exp_year:authorization.exp_year??null,email:event.data.customer.email},
    recurring_provider:"paystack",recurring_enabled:true,updated_at:now
   },{onConflict:"workspace_id"});
   if(customerError)throw customerError;
  }

  const {error:settleError}=await admin.rpc("settle_paystack_workspace_payment",{
   p_payment_id:payment.id,p_transaction_id:Number(event.data.id),p_paid_at:event.data.paid_at||now
  });
  if(settleError)throw settleError;

  if(payment.recurring_setup){
   const interval=payment.plan_slug.endsWith("-annual")?"year":"month";
   const {error:subscriptionError}=await admin.from("workspace_subscriptions").update({
    auto_renew:true,recurring_interval:interval,billing_provider:"paystack",updated_at:now
   }).eq("workspace_id",payment.workspace_id);
   if(subscriptionError)throw subscriptionError;
   if(payment.recurring_consent_id){
    const {error:consentError}=await admin.from("billing_recurring_consents").update({status:"active",updated_at:now}).eq("id",payment.recurring_consent_id);
    if(consentError)throw consentError;
   }
  }

  if(payment.recurring_job_id){
   const {error:jobError}=await admin.rpc("complete_paystack_recurring_renewal",{p_job_id:payment.recurring_job_id});
   if(jobError)throw jobError;
  }
  const {error:markError}=await admin.from("billing_webhook_events").update({processed_at:now}).eq("event_key",eventKey);
  if(markError)throw markError;
  return NextResponse.json({received:true});
 }catch(error){
  console.error("Paystack webhook processing failed:",error);
  return NextResponse.json({error:"Webhook processing failed."},{status:500});
 }
}
