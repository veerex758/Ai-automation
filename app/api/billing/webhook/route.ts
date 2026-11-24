import {NextResponse} from "next/server";
import {createHash} from "node:crypto";
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
function privateJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export async function POST(request:Request){
 const secret=process.env.PAYSTACK_SECRET_KEY;
 if(!secret)return privateJson({error:"Webhook unavailable."},{status:503});
 const raw=await request.text();
 if(new TextEncoder().encode(raw).byteLength>256*1024)return privateJson({error:"Payload too large."},{status:413});
 if(!isValidPaystackSignature(raw,request.headers.get("x-paystack-signature"),secret))return privateJson({error:"Invalid signature."},{status:401});
 let event:PaystackChargeEvent;
 try{event=JSON.parse(raw) as PaystackChargeEvent;}catch{return privateJson({error:"Invalid JSON."},{status:400});}
 if(!["charge.success","charge.failed"].includes(event.event??"")||typeof event.data?.reference!=="string")return privateJson({received:true});
 let claimAdmin:ReturnType<typeof createAdminClient>|null=null;
 let claimEventKey:string|null=null;
 let claimToken:string|null=null;
 try{
  const admin=createAdminClient(),now=new Date().toISOString();
  claimAdmin=admin;
  const {data:payment,error:paymentError}=await admin.from("billing_payments").select("*").eq("reference",event.data.reference).maybeSingle();
  if(paymentError)throw paymentError;
  if(!payment)return privateJson({received:true});
  if(event.event==="charge.success"&&!isVerifiedPayment(event.data,{amountMinor:payment.amount_minor,currency:payment.currency}))
   return privateJson({error:"Payment details mismatch."},{status:422});

  const recurringAuthorization=event.event==="charge.success"&&payment.recurring_setup?event.data.authorization:undefined;
  const recurringEncryptionKey=process.env.AIVANTA_CREDENTIALS_ENCRYPTION_KEY;
  if(event.event==="charge.success"&&payment.recurring_setup){
   if(!recurringAuthorization?.authorization_code||recurringAuthorization.reusable!==true||!event.data.customer?.email)
    return privateJson({error:"Reusable Paystack authorization was not returned."},{status:422});
   if(!recurringEncryptionKey)return privateJson({error:"Authorization encryption is not configured."},{status:503});
  }

  const eventKey=event.event+":"+payment.reference;
  claimEventKey=eventKey;
  const payloadHash=createHash("sha256").update(raw).digest("hex");
  const {data:claimRows,error:claimError}=await admin.rpc("claim_billing_webhook_event",{
   p_provider:"paystack",p_event_key:eventKey,p_event_type:event.event,p_payload_hash:payloadHash,
   p_reference:payment.reference,p_workspace_id:payment.workspace_id,p_lease_seconds:900
  });
  if(claimError)throw claimError;
  const claim=Array.isArray(claimRows)?claimRows[0]:claimRows;
  if(!claim||typeof claim!=="object")throw new Error("PAYSTACK_WEBHOOK_CLAIM_INVALID");
  const claimRecord=claim as Record<string,unknown>;
  if(claimRecord.reason==="payload_mismatch"||claimRecord.reason==="event_key_conflict")
   return privateJson({error:"Webhook event key conflicts with its stored payload."},{status:409});
  if(claimRecord.claimed!==true||typeof claimRecord.claim_token!=="string"){
   if(claimRecord.reason==="in_progress"||claimRecord.reason==="completed")
    return privateJson({received:true,duplicate:true});
   throw new Error("PAYSTACK_WEBHOOK_CLAIM_UNAVAILABLE");
  }
  claimToken=claimRecord.claim_token;

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
   const {data:completed,error:completeError}=await admin.rpc("complete_billing_webhook_event",{
    p_provider:"paystack",p_event_key:eventKey,p_claim_token:claimToken
   });
   if(completeError||completed!==true)throw completeError??new Error("PAYSTACK_WEBHOOK_CLAIM_LOST");
   return privateJson({received:true});
  }

  if(payment.recurring_setup){
   const authorization=recurringAuthorization!;
   const encrypted=encryptWebhookSecret(authorization.authorization_code,recurringEncryptionKey!).toString("base64");
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
  const {data:completed,error:completeError}=await admin.rpc("complete_billing_webhook_event",{
   p_provider:"paystack",p_event_key:eventKey,p_claim_token:claimToken
  });
  if(completeError||completed!==true)throw completeError??new Error("PAYSTACK_WEBHOOK_CLAIM_LOST");
  return privateJson({received:true});
 }catch(error){
  if(claimAdmin&&claimEventKey&&claimToken){
   const {error:releaseError}=await claimAdmin.rpc("release_billing_webhook_event",{
    p_provider:"paystack",p_event_key:claimEventKey,p_claim_token:claimToken,p_error_code:"PROCESSING_FAILED"
   });
   if(releaseError)console.error("Paystack webhook claim release failed.");
  }
  console.error("Paystack webhook processing failed:",error);
  return privateJson({error:"Webhook processing failed."},{status:500});
 }
}
