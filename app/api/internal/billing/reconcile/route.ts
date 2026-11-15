import {timingSafeEqual} from "node:crypto";
import {NextResponse,type NextRequest} from "next/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {isVerifiedPayment} from "@/lib/billing/paystack";
export const runtime="nodejs";
export const dynamic="force-dynamic";
function authorized(request:NextRequest){
 const secret=process.env.CRON_SECRET??process.env.AIVANTA_WORKER_SECRET;
 if(!secret)return false;
 const expected=Buffer.from("Bearer "+secret),received=Buffer.from(request.headers.get("authorization")??"");
 return expected.length===received.length&&timingSafeEqual(expected,received);
}
export async function POST(request:NextRequest){
 if(!authorized(request))return NextResponse.json({error:"Unauthorized."},{status:401});
 const secret=process.env.PAYSTACK_SECRET_KEY;if(!secret)return NextResponse.json({error:"Paystack is not configured."},{status:503});
 try{
  const admin=createAdminClient(),cutoff=new Date(Date.now()-5*60*1000).toISOString();
  const {data:pending,error}=await admin.from("billing_payments").select("id,reference,amount_minor,currency,created_at,status").eq("provider","paystack").eq("status","pending").lt("created_at",cutoff).order("created_at",{ascending:true}).limit(50);
  if(error)throw error;
  let settled=0,failed=0,stillPending=0,abandoned=0;
  for(const payment of pending??[]){
   if(Date.now()-Date.parse(payment.created_at)>48*60*60*1000){
    const {error:updateError}=await admin.from("billing_payments").update({status:"abandoned",updated_at:new Date().toISOString()}).eq("id",payment.id).eq("status","pending");
    if(updateError)throw updateError;abandoned++;continue;
   }
   const response=await fetch("https://api.paystack.co/transaction/verify/"+encodeURIComponent(payment.reference),{headers:{Authorization:"Bearer "+secret},cache:"no-store",signal:AbortSignal.timeout(10000)});
   if(!response.ok){stillPending++;continue;}
   const result=await response.json();
   if(result.status!==true||!result.data){stillPending++;continue;}
   if(result.data.status==="success"){
    if(!isVerifiedPayment(result.data,{amountMinor:payment.amount_minor,currency:payment.currency})){failed++;continue;}
    const {error:settleError}=await admin.rpc("settle_paystack_workspace_payment",{p_payment_id:payment.id,p_transaction_id:result.data.id,p_paid_at:result.data.paid_at||new Date().toISOString()});
    if(settleError)throw settleError;settled++;
   }else if(["failed","abandoned"].includes(String(result.data.status))){
    const {error:updateError}=await admin.from("billing_payments").update({status:"failed",updated_at:new Date().toISOString()}).eq("id",payment.id).eq("status","pending");
    if(updateError)throw updateError;failed++;
   }else stillPending++;
  }
  const {data:lifecycle,error:lifecycleError}=await admin.rpc("expire_workspace_subscriptions");
  if(lifecycleError)throw lifecycleError;
  return NextResponse.json({checked:pending?.length??0,settled,failed,still_pending:stillPending,abandoned,lifecycle},{headers:{"Cache-Control":"no-store"}});
 }catch(error){console.error("Billing reconciliation failed:",error);return NextResponse.json({error:"Billing reconciliation failed."},{status:503});}
}
