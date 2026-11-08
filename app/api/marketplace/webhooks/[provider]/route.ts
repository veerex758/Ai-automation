import {NextRequest,NextResponse} from "next/server";
import {createClient as adminClient} from "@supabase/supabase-js";
import {processMarketplaceWebhook,type MarketplaceWebhookProcessor} from "@/lib/marketplace/payments/process-webhook";
import {paystackMarketplaceProvider} from "@/lib/marketplace/payments/paystack";
import {stripeMarketplaceProvider} from "@/lib/marketplace/payments/stripe";
export const runtime="nodejs";const headers={"Cache-Control":"no-store"};
export async function POST(req:NextRequest,ctx:{params:Promise<{provider:string}>}){
 const {provider}=await ctx.params,adapter=provider==="paystack"?paystackMarketplaceProvider:provider==="stripe"?stripeMarketplaceProvider:null;
 if(!adapter)return NextResponse.json({error:"Unknown payment provider."},{status:404,headers});
 try{
  const raw=new Uint8Array(await req.arrayBuffer());if(!raw.byteLength||raw.byteLength>1_000_000)return NextResponse.json({error:"Invalid webhook size."},{status:413,headers});
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw new Error("webhook_service_unavailable");
  const db=adminClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
  const processor:MarketplaceWebhookProcessor={
   finalizePayment:async x=>await db.rpc("marketplace_finalize_payment",{p_provider:x.provider,p_event_id:x.eventId,p_purchase_id:x.purchaseId,p_provider_payment_id:x.providerPaymentId,p_amount_minor:x.amountMinor,p_currency:x.currency,p_payload_sha256:x.payloadSha256,p_occurred_at:x.occurredAt}),
   reversePayment:async x=>await db.rpc("marketplace_reverse_payment",{p_provider:x.provider,p_event_id:x.eventId,p_purchase_id:x.purchaseId,p_kind:x.kind,p_amount_minor:x.amountMinor,p_payload_sha256:x.payloadSha256,p_occurred_at:x.occurredAt})
  };
  const result=await processMarketplaceWebhook(adapter,processor,raw,req.headers);return NextResponse.json({received:true,eventId:result.eventId},{headers});
 }catch(e){console.error("Marketplace webhook rejected/failed",e);return NextResponse.json({error:"Webhook verification or processing failed."},{status:400,headers});}
}
