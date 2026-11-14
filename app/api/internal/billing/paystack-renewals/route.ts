import {NextResponse} from "next/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {decryptWebhookSecret} from "@/lib/webhooks/secret-crypto";
import {createPaymentReference,getPaidPlan} from "@/lib/billing/paystack";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(request:Request){
 const cron=process.env.CRON_SECRET,secret=process.env.PAYSTACK_SECRET_KEY,key=process.env.AIVANTA_CREDENTIALS_ENCRYPTION_KEY;
 if(!cron||request.headers.get("authorization")!=="Bearer "+cron)return NextResponse.json({error:"Unauthorized."},{status:401});
 if(!secret||!key)return NextResponse.json({error:"Paystack recurring billing is not configured."},{status:503});
 const admin=createAdminClient();
 try{
  const now=new Date().toISOString();
  const {data:subscriptions,error}=await admin.from("workspace_subscriptions").select("workspace_id,plan_key,current_period_end,recurring_interval,provider_subscription_id").eq("billing_provider","paystack").eq("status","active").eq("auto_renew",true).lte("current_period_end",now).limit(100);
  if(error)throw error;
  let attempted=0,started=0,failed=0,skipped=0;
  for(const sub of subscriptions??[]){
   attempted++;
   const [{data:customer,error:customerError},{data:workspace,error:workspaceError}]=await Promise.all([
    admin.from("workspace_billing_customers").select("paystack_customer_code,paystack_authorization_code_enc,paystack_authorization_meta,recurring_enabled").eq("workspace_id",sub.workspace_id).maybeSingle(),
    admin.from("workspaces").select("owner_id").eq("id",sub.workspace_id).maybeSingle()
   ]);
   if(customerError||workspaceError)throw customerError??workspaceError;
   if(!customer?.recurring_enabled||!customer.paystack_authorization_code_enc||!customer.paystack_authorization_meta?.email||!workspace?.owner_id){skipped++;continue;}
   const interval=sub.recurring_interval==="year"?"annual":"monthly",slug=sub.plan_key+"-"+interval,plan=getPaidPlan(slug);
   if(!plan){skipped++;continue;}
   const periodKey=new Date(sub.current_period_end).toISOString().slice(0,10),eventKey="paystack_renewal:"+sub.workspace_id+":"+periodKey;
   const {error:claimError}=await admin.from("billing_recurring_events").insert({provider:"paystack",event_key:eventKey,event_type:"renewal_requested",workspace_id:sub.workspace_id,payload_hash:periodKey});
   if(claimError?.code==="23505"){skipped++;continue;}if(claimError)throw claimError;
   try{
    const authCode=decryptWebhookSecret(Buffer.from(customer.paystack_authorization_code_enc,"base64"),key),reference=createPaymentReference();
    const {data:payment,error:paymentError}=await admin.from("billing_payments").insert({workspace_id:sub.workspace_id,user_id:workspace.owner_id,provider:"paystack",reference,plan_slug:plan.slug,amount_minor:plan.amountMinor,currency:plan.currency,status:"pending",recurring_cycle_start:sub.current_period_end,recurring_cycle_end:null}).select("id").single();
    if(paymentError)throw paymentError;
    const response=await fetch("https://api.paystack.co/transaction/charge_authorization",{method:"POST",headers:{Authorization:"Bearer "+secret,"Content-Type":"application/json"},body:JSON.stringify({authorization_code:authCode,email:customer.paystack_authorization_meta.email,amount:plan.amountMinor,currency:plan.currency,reference}),cache:"no-store",signal:AbortSignal.timeout(15000)});
    const result=await response.json();
    if(!response.ok||result.status!==true||!result.data?.reference){await admin.from("billing_payments").update({status:"failed",updated_at:new Date().toISOString()}).eq("id",payment.id);throw new Error("Paystack recurring charge failed.");}
    await admin.from("billing_recurring_events").update({processed_at:new Date().toISOString()}).eq("event_key",eventKey);started++;
   }catch(e){failed++;await admin.from("billing_recurring_events").update({processing_error:"renewal_charge_failed"}).eq("event_key",eventKey);console.error("Paystack recurring renewal failed for workspace",sub.workspace_id,e);}
  }
  return NextResponse.json({attempted,started,failed,skipped},{headers:{"Cache-Control":"no-store"}});
 }catch(error){console.error("Paystack recurring renewal scheduler failed:",error);return NextResponse.json({error:"Recurring renewal processing failed."},{status:503});}
}
