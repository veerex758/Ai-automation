import {NextResponse} from "next/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {decryptWebhookSecret} from "@/lib/webhooks/secret-crypto";
import {createPaymentReference,getPaidPlan,isVerifiedPayment} from "@/lib/billing/paystack";
export const runtime="nodejs";
export const dynamic="force-dynamic";

type PaystackVerifyResult={
 status?:boolean;
 data?:{status?:string;reference?:string;amount?:number;currency?:string;id?:number;paid_at?:string};
};

async function reconcileAwaitingConfirmations(admin:ReturnType<typeof createAdminClient>,secret:string,now:Date){
 const staleBefore=new Date(now.getTime()-15*60*1000).toISOString();
 const staleAfter=new Date(now.getTime()-72*60*60*1000).toISOString();
 const {data:jobs,error}=await admin.from("billing_paystack_renewal_jobs")
  .select("id,workspace_id,payment_id,updated_at")
  .eq("status","awaiting_confirmation").lt("updated_at",staleBefore).limit(100);
 if(error)throw error;
 let reconciled=0,held=0,expired=0;
 for(const job of jobs??[]){
  if(!job.payment_id){held++;continue;}
  const {data:payment,error:paymentError}=await admin.from("billing_payments")
   .select("id,reference,amount_minor,currency,status,workspace_id")
   .eq("id",job.payment_id).maybeSingle();
  if(paymentError)throw paymentError;
  if(!payment){held++;continue;}
  if(payment.status==="success"){
   await admin.rpc("complete_paystack_recurring_renewal",{p_job_id:job.id});
   reconciled++;continue;
  }
  try{
   const response=await fetch("https://api.paystack.co/transaction/verify/"+encodeURIComponent(payment.reference),{
    method:"GET",headers:{Authorization:"Bearer "+secret},cache:"no-store",signal:AbortSignal.timeout(12000)
   });
   const result=await response.json() as PaystackVerifyResult;
   const details=result.data;
   if(response.ok&&result.status===true&&details&&details.status==="success"&&
      isVerifiedPayment(details,{amountMinor:payment.amount_minor,currency:payment.currency})){
    const {error:settleError}=await admin.rpc("settle_paystack_workspace_payment",{
     p_payment_id:payment.id,p_transaction_id:Number(details.id),p_paid_at:details.paid_at||now.toISOString()
    });
    if(settleError)throw settleError;
    const {error:completeError}=await admin.rpc("complete_paystack_recurring_renewal",{p_job_id:job.id});
    if(completeError)throw completeError;
    reconciled++;continue;
   }
   if(response.ok&&result.status===true&&details&&["failed","abandoned"].includes(String(details.status))){
    await admin.from("billing_payments").update({status:"failed",updated_at:now.toISOString()}).eq("id",payment.id);
    const {error:retryError}=await admin.rpc("retry_paystack_recurring_renewal",{p_job_id:job.id,p_error_code:"PAYSTACK_CHARGE_FAILED"});
    if(retryError)throw retryError;
    await admin.from("workspace_subscriptions").update({
     status:"past_due",grace_until:new Date(now.getTime()+7*86400000).toISOString(),updated_at:now.toISOString()
    }).eq("workspace_id",job.workspace_id).eq("billing_provider","paystack");
    reconciled++;continue;
   }
  }catch(error){
   console.error("Paystack renewal verification could not be completed for job",job.id,error);
  }
  if(Date.parse(job.updated_at)<Date.parse(staleAfter)){
   await admin.from("billing_paystack_renewal_jobs").update({
    status:"failed",last_error_code:"PAYSTACK_CONFIRMATION_TIMEOUT",updated_at:now.toISOString()
   }).eq("id",job.id).eq("status","awaiting_confirmation");
   expired++;
  }else held++;
 }
 return {reconciled,held,expired};
}

export async function POST(request:Request){
 const cron=process.env.CRON_SECRET,secret=process.env.PAYSTACK_SECRET_KEY,key=process.env.AIVANTA_CREDENTIALS_ENCRYPTION_KEY;
 if(!cron||request.headers.get("authorization")!=="Bearer "+cron)return NextResponse.json({error:"Unauthorized."},{status:401});
 if(!secret||!key)return NextResponse.json({error:"Paystack recurring billing is not configured."},{status:503});
 const admin=createAdminClient();
 try{
  const now=new Date(),nowIso=now.toISOString();
  const reconciliation=await reconcileAwaitingConfirmations(admin,secret,now);
  const {data:subscriptions,error}=await admin.from("workspace_subscriptions")
   .select("workspace_id,plan_key,current_period_end,recurring_interval,provider_subscription_id,status,grace_until")
   .eq("billing_provider","paystack").in("status",["active","past_due"])
   .eq("auto_renew",true).lte("current_period_end",nowIso).limit(100);
  if(error)throw error;
  let attempted=0,started=0,failed=0,skipped=0;
  for(const sub of subscriptions??[]){
   if(sub.status==="past_due"&&sub.grace_until&&Date.parse(sub.grace_until)<=now.getTime()){
    await admin.from("workspace_subscriptions").update({status:"canceled",auto_renew:false,cancel_at_period_end:false,updated_at:nowIso})
     .eq("workspace_id",sub.workspace_id).eq("billing_provider","paystack");
    await admin.from("workspace_billing_customers").update({recurring_enabled:false,updated_at:nowIso}).eq("workspace_id",sub.workspace_id);
    skipped++;continue;
   }
   const [{data:customer,error:customerError},{data:workspace,error:workspaceError}]=await Promise.all([
    admin.from("workspace_billing_customers").select("paystack_authorization_code_enc,paystack_authorization_meta,recurring_enabled")
     .eq("workspace_id",sub.workspace_id).maybeSingle(),
    admin.from("workspaces").select("owner_id").eq("id",sub.workspace_id).maybeSingle()
   ]);
   if(customerError||workspaceError)throw customerError??workspaceError;
   if(!customer?.recurring_enabled||!customer.paystack_authorization_code_enc||!customer.paystack_authorization_meta?.email||!workspace?.owner_id){skipped++;continue;}
   const interval=sub.recurring_interval==="year"?"annual":"monthly",slug=sub.plan_key+"-"+interval,plan=getPaidPlan(slug);
   if(!plan){skipped++;continue;}
   attempted++;
   const {data:claims,error:claimError}=await admin.rpc("claim_paystack_recurring_renewal",{
    p_workspace_id:sub.workspace_id,p_period_end:sub.current_period_end,p_lease_seconds:120
   });
   if(claimError)throw claimError;
   const claim=Array.isArray(claims)?claims[0]:null;
   if(!claim?.job_id||!claim?.lease_token){skipped++;continue;}
   let paymentId:string|undefined;
   let awaitingConfirmation=false;
   try{
    const authCode=decryptWebhookSecret(Buffer.from(customer.paystack_authorization_code_enc,"base64"),key);
    const reference=createPaymentReference();
    const {data:payment,error:paymentError}=await admin.from("billing_payments").insert({
     workspace_id:sub.workspace_id,user_id:workspace.owner_id,provider:"paystack",reference,
     plan_slug:plan.slug,amount_minor:plan.amountMinor,currency:plan.currency,status:"pending",
     recurring_cycle_start:sub.current_period_end,recurring_cycle_end:null,recurring_job_id:claim.job_id
    }).select("id").single();
    if(paymentError)throw paymentError;
    paymentId=payment.id;
    // Persist the reference before contacting Paystack. A timeout is then reconciled by reference,
    // never blindly re-charged with a fresh reference.
    const {error:finishError}=await admin.rpc("finish_paystack_recurring_renewal",{
     p_job_id:claim.job_id,p_lease_token:claim.lease_token,p_outcome:"awaiting_confirmation",p_payment_id:paymentId
    });
    if(finishError)throw finishError;
    awaitingConfirmation=true;
    const response=await fetch("https://api.paystack.co/transaction/charge_authorization",{
     method:"POST",headers:{Authorization:"Bearer "+secret,"Content-Type":"application/json"},
     body:JSON.stringify({authorization_code:authCode,email:customer.paystack_authorization_meta.email,
      amount:plan.amountMinor,currency:plan.currency,reference}),
     cache:"no-store",signal:AbortSignal.timeout(15000)
    });
    let result:{status?:boolean;data?:{reference?:string}}={};
    try{result=await response.json() as {status?:boolean;data?:{reference?:string}};}catch{/* Verify the persisted reference on the next scheduler pass. */}
    if(response.ok&&result.status===false){
     await admin.from("billing_payments").update({status:"failed",updated_at:new Date().toISOString()}).eq("id",paymentId);
     const {error:retryError}=await admin.rpc("retry_paystack_recurring_renewal",{
      p_job_id:claim.job_id,p_error_code:"PAYSTACK_CHARGE_FAILED"
     });
     if(retryError)throw retryError;
     await admin.from("workspace_subscriptions").update({
      status:"past_due",grace_until:new Date(Date.now()+7*86400000).toISOString(),updated_at:new Date().toISOString()
     }).eq("workspace_id",sub.workspace_id).eq("billing_provider","paystack");
     failed++;continue;
    }
    // A successful or ambiguous response remains awaiting confirmation until webhook/verify confirms it.
    started++;
   }catch(error){
    if(!awaitingConfirmation){
     const {error:finishError}=await admin.rpc("finish_paystack_recurring_renewal",{
      p_job_id:claim.job_id,p_lease_token:claim.lease_token,p_outcome:"retry",p_payment_id:paymentId,
      p_error_code:"PAYSTACK_RENEWAL_PREPARATION_FAILED"
     });
     if(finishError)console.error("Could not release Paystack renewal claim",claim.job_id,finishError);
    }
    failed++;
    console.error("Paystack recurring renewal failed for workspace",sub.workspace_id,error);
   }
  }
  return NextResponse.json({attempted,started,failed,skipped,awaitingConfirmation:reconciliation.held,reconciliation},{headers:{"Cache-Control":"no-store"}});
 }catch(error){
  console.error("Paystack recurring renewal scheduler failed:",error);
  return NextResponse.json({error:"Recurring renewal processing failed."},{status:503});
 }
}
