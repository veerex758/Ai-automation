import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidPaystackSignature, isVerifiedPayment } from "@/lib/billing/paystack";
export const runtime = "nodejs";
export async function POST(request: Request) {
 const secret=process.env.PAYSTACK_SECRET_KEY;
 if(!secret) return NextResponse.json({error:"Webhook unavailable."},{status:503});
 const raw=await request.text();
 if(!isValidPaystackSignature(raw,request.headers.get("x-paystack-signature"),secret)) return NextResponse.json({error:"Invalid signature."},{status:401});
 let event:any;
 try { event=JSON.parse(raw); } catch { return NextResponse.json({error:"Invalid JSON."},{status:400}); }
 if(event.event!=="charge.success"||!event.data?.reference) return NextResponse.json({received:true});
 const admin=createAdminClient();
 const {data:payment,error}=await admin.from("billing_payments").select("*").eq("reference",event.data.reference).maybeSingle();
 if(error) return NextResponse.json({error:"Unable to locate payment."},{status:500});
 if(!payment) return NextResponse.json({received:true});
 const {error:duplicate}=await admin.from("billing_webhook_events").insert({event_key:"charge.success:"+payment.reference,event_type:"charge.success",reference:payment.reference});
 if(duplicate?.code==="23505") return NextResponse.json({received:true,duplicate:true});
 if(duplicate) return NextResponse.json({error:"Unable to record event."},{status:500});
 if(!isVerifiedPayment(event.data,{amountMinor:payment.amount_minor,currency:payment.currency})) return NextResponse.json({error:"Payment details mismatch."},{status:422});
 if(payment.status!=="success") {
  const now=new Date(), end=new Date(now.getTime()+30*86400000);
  const {error:payError}=await admin.from("billing_payments").update({status:"success",provider_transaction_id:event.data.id,paid_at:event.data.paid_at||now.toISOString()}).eq("id",payment.id).neq("status","success");
  if(payError) return NextResponse.json({error:"Unable to update payment."},{status:500});
  const {error:subError}=await admin.from("workspace_subscriptions").upsert({workspace_id:payment.workspace_id,provider:"paystack",plan_slug:payment.plan_slug,status:"active",currency:payment.currency,amount_minor:payment.amount_minor,current_period_start:now.toISOString(),current_period_end:end.toISOString(),last_payment_id:payment.id},{onConflict:"workspace_id"});
  if(subError) return NextResponse.json({error:"Entitlement update requires retry."},{status:500});
 }
 await admin.from("billing_webhook_events").update({processed_at:new Date().toISOString()}).eq("event_key","charge.success:"+payment.reference);
 return NextResponse.json({received:true});
}
