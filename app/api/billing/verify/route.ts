import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
import { createAdminClient } from "@/lib/supabase/admin";
import { isVerifiedPayment } from "@/lib/billing/paystack";
export const runtime="nodejs";
export async function POST(request:Request) {
 try {
  const client=await createClient(), {data:{user}}=await client.auth.getUser();
  if(!user) return NextResponse.json({error:"Authentication required."},{status:401});
  const body=await request.json(), reference=typeof body?.reference==="string"?body.reference:"";
  if(!/^aivanta_[a-z0-9]+_[a-f0-9]{24}$/.test(reference)) return NextResponse.json({error:"Invalid reference."},{status:400});
  const workspace=await getOrCreateDefaultWorkspace(client), admin=createAdminClient();
  const {data:payment,error}=await admin.from("billing_payments").select("*").eq("reference",reference).eq("workspace_id",workspace.id).eq("user_id",user.id).maybeSingle();
  if(error) throw error;
  if(!payment) return NextResponse.json({error:"Payment not found."},{status:404});
  if(payment.status==="success") return NextResponse.json({success:true,alreadyProcessed:true});
  const secret=process.env.PAYSTACK_SECRET_KEY;
  if(!secret) return NextResponse.json({error:"Payment provider unavailable."},{status:503});
  const response=await fetch("https://api.paystack.co/transaction/verify/"+encodeURIComponent(reference),{headers:{Authorization:"Bearer "+secret},cache:"no-store"});
  const result=await response.json();
  if(!response.ok||result.status!==true||!isVerifiedPayment(result.data,{amountMinor:payment.amount_minor,currency:payment.currency})) return NextResponse.json({error:"Payment is not verified as successful."},{status:409});
  const now=new Date(), end=new Date(now.getTime()+30*86400000);
  const {data:changed,error:updateError}=await admin.from("billing_payments").update({status:"success",provider_transaction_id:result.data.id,paid_at:result.data.paid_at||now.toISOString()}).eq("id",payment.id).neq("status","success").select("id").maybeSingle();
  if(updateError) throw updateError;
  if(changed) {
   const {error:subError}=await admin.from("workspace_subscriptions").upsert({workspace_id:workspace.id,provider:"paystack",plan_slug:payment.plan_slug,status:"active",currency:payment.currency,amount_minor:payment.amount_minor,current_period_start:now.toISOString(),current_period_end:end.toISOString(),last_payment_id:payment.id},{onConflict:"workspace_id"});
   if(subError) throw subError;
  }
  return NextResponse.json({success:true},{headers:{"Cache-Control":"private, no-store"}});
 } catch(error) { console.error("Payment verification failed:",error); return NextResponse.json({error:"Could not verify payment."},{status:500}); }
}
