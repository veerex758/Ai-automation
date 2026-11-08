import {NextResponse,type NextRequest} from "next/server";
import {createClient as adminClient} from "@supabase/supabase-js";
import {createClient} from "@/lib/supabase/server";
import {paystackMarketplaceProvider} from "@/lib/marketplace/payments/paystack";
import {stripeMarketplaceProvider} from "@/lib/marketplace/payments/stripe";
const headers={"Cache-Control":"no-store"};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function POST(req:NextRequest){
 try{
  const session=await createClient(),{data:{user},error}=await session.auth.getUser();if(error||!user)return NextResponse.json({error:"Authentication required."},{status:401,headers});
  const raw=await req.text();if(raw.length>4096)return NextResponse.json({error:"Request too large."},{status:413,headers});
  let b:unknown;try{b=JSON.parse(raw)}catch{return NextResponse.json({error:"Invalid JSON."},{status:400,headers})}
  if(!b||typeof b!=="object"||Array.isArray(b))return NextResponse.json({error:"Invalid request."},{status:400,headers});
  const x=b as Record<string,unknown>,provider=x.provider,productId=x.productId,versionId=x.versionId,key=x.idempotencyKey;
  if(!["paystack","stripe"].includes(String(provider))||!uuid.test(String(productId))||!uuid.test(String(versionId))||typeof key!=="string"||key.length<8||key.length>128)return NextResponse.json({error:"Invalid checkout fields."},{status:400,headers});
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,secret=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!secret)throw new Error("checkout_service_unavailable");
  const db=adminClient(url,secret,{auth:{autoRefreshToken:false,persistSession:false}});
  const {data:rows,error:rpcError}=await db.rpc("marketplace_create_checkout_purchase",{p_product_id:productId,p_version_id:versionId,p_buyer_id:user.id,p_provider:provider,p_idempotency_key:key});if(rpcError)throw rpcError;
  const purchase=Array.isArray(rows)?rows[0]:rows;if(!purchase?.purchase_id)throw new Error("checkout_purchase_missing");
  const origin=req.nextUrl.origin,successUrl=new URL("/marketplace/purchases?checkout=success",origin).toString(),cancelUrl=new URL("/marketplace?checkout=cancelled",origin).toString();
  const adapter=provider==="paystack"?paystackMarketplaceProvider:stripeMarketplaceProvider;
  const result=await adapter.createCheckout({purchaseId:purchase.purchase_id,idempotencyKey:key,amountMinor:purchase.amount_minor,currency:"USD",product:{id:String(productId),slug:purchase.product_slug,name:purchase.product_name},versionId:String(versionId),buyerId:user.id,buyerEmail:user.email??"",successUrl,cancelUrl});
  const {error:updateError}=await db.from("marketplace_purchases").update({provider_checkout_id:result.providerCheckoutId}).eq("id",purchase.purchase_id).eq("buyer_user_id",user.id);if(updateError)throw updateError;
  return NextResponse.json({purchaseId:purchase.purchase_id,checkoutUrl:result.checkoutUrl,provider},{headers});
 }catch(e){console.error("Marketplace checkout failed",e);return NextResponse.json({error:"Checkout could not be initialized."},{status:400,headers});}
}
