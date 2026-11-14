import Stripe from "stripe";
import {NextResponse} from "next/server";
import {createAdminClient} from "@/lib/supabase/admin";
export const runtime="nodejs";
export async function POST(request:Request){
 const secret=process.env.STRIPE_SECRET_KEY,webhookSecret=process.env.STRIPE_WEBHOOK_SECRET;
 if(!secret||!webhookSecret)return NextResponse.json({error:"Stripe webhook is not configured."},{status:503});
 const raw=await request.text();if(new TextEncoder().encode(raw).byteLength>256*1024)return NextResponse.json({error:"Payload too large."},{status:413});
 const stripe=new Stripe(secret);let event:Stripe.Event;
 try{const signature=request.headers.get("stripe-signature");if(!signature)throw new Error("missing_signature");event=stripe.webhooks.constructEvent(raw,signature,webhookSecret);}
 catch{return NextResponse.json({error:"Invalid Stripe signature."},{status:401});}
 if(event.type!=="checkout.session.completed")return NextResponse.json({received:true});
 const session=event.data.object as Stripe.Checkout.Session;
 if(session.payment_status!=="paid"||typeof session.metadata?.payment_id!=="string")return NextResponse.json({error:"Checkout session is not paid or lacks payment metadata."},{status:422});
 try{
  const admin=createAdminClient(),{data:payment,error}=await admin.from("billing_payments").select("id,provider,workspace_id,amount_minor,currency,status").eq("id",session.metadata.payment_id).maybeSingle();
  if(error)throw error;if(!payment||payment.provider!=="stripe"||payment.workspace_id!==session.metadata.workspace_id)return NextResponse.json({error:"Payment record mismatch."},{status:422});
  if(session.amount_total!==payment.amount_minor||String(session.currency).toUpperCase()!==payment.currency)return NextResponse.json({error:"Stripe payment amount mismatch."},{status:422});
  const {error:eventError}=await admin.from("billing_webhook_events").insert({provider:"stripe",event_key:event.id,event_type:event.type,reference:session.id});
  if(eventError&&eventError.code!=="23505")throw eventError;
  const {data:prior}=await admin.from("billing_webhook_events").select("processed_at").eq("event_key",event.id).maybeSingle();
  if(prior?.processed_at)return NextResponse.json({received:true,duplicate:true});
  const {error:settleError}=await admin.rpc("settle_stripe_workspace_payment",{p_payment_id:payment.id,p_session_id:session.id,p_paid_at:new Date().toISOString()});
  if(settleError)throw settleError;
  const {error:markError}=await admin.from("billing_webhook_events").update({processed_at:new Date().toISOString()}).eq("event_key",event.id);
  if(markError)throw markError;
  return NextResponse.json({received:true});
 }catch(error){console.error("Stripe webhook processing failed:",error);return NextResponse.json({error:"Stripe webhook processing failed."},{status:503});}
}
