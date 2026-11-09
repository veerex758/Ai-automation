import { NextRequest, NextResponse } from "next/server";
import { createClient as adminClient } from "@supabase/supabase-js";
import { getMarketplacePaymentProvider } from "@/lib/marketplace/payments/provider-registry";
import { processMarketplaceWebhook } from "@/lib/marketplace/payments/process-webhook";
export const runtime = "nodejs";
const headers={"Cache-Control":"no-store"};
type Context={params:Promise<{provider:string}>};
export async function POST(req:NextRequest,ctx:Context){
 try{
  const {provider:providerId}=await ctx.params;if(providerId!=="paystack"&&providerId!=="stripe")return NextResponse.json({error:"Unknown provider."},{status:404,headers});
  const raw=new Uint8Array(await req.arrayBuffer());if(raw.byteLength===0||raw.byteLength>1_000_000)return NextResponse.json({error:"Invalid webhook body size."},{status:413,headers});
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw Error("Payment processor unavailable");
  const admin=adminClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
  const processor={
   async finalizePayment(input:{provider:string;eventId:string;purchaseId:string;providerPaymentId:string;amountMinor:number;currency:string;payloadSha256:string;occurredAt:string}){
    const {data,error}=await admin.rpc("marketplace_finalize_payment",{p_provider:input.provider,p_event_id:input.eventId,p_purchase_id:input.purchaseId,p_provider_payment_id:input.providerPaymentId,p_amount_minor:input.amountMinor,p_currency:input.currency,p_payload_sha256:input.payloadSha256,p_occurred_at:input.occurredAt});if(error)throw error;return data;
   },
   async reversePayment(input:{provider:string;eventId:string;purchaseId:string;kind:"refund"|"chargeback";amountMinor:number;payloadSha256:string;occurredAt:string}){
    const {data,error}=await admin.rpc("marketplace_reverse_payment",{p_provider:input.provider,p_event_id:input.eventId,p_purchase_id:input.purchaseId,p_kind:input.kind,p_amount_minor:input.amountMinor,p_payload_sha256:input.payloadSha256,p_occurred_at:input.occurredAt});if(error)throw error;return data;
   }
  };
  const result=await processMarketplaceWebhook(getMarketplacePaymentProvider(providerId),processor,raw,req.headers);
  return NextResponse.json({received:true,eventId:result.eventId,outcome:result.outcome},{status:200,headers});
 }catch(error){console.error("Marketplace webhook rejected/failed",error);return NextResponse.json({error:"Webhook verification or processing failed."},{status:400,headers})}
}
