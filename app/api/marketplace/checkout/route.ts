import { NextRequest, NextResponse } from "next/server";
import { createClient as adminClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getMarketplacePaymentProvider } from "@/lib/marketplace/payments/provider-registry";
const headers = { "Cache-Control": "private, no-store" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function POST(req: NextRequest) {
 try {
  if (process.env.AIVANTA_MARKETPLACE_CHECKOUT_ENABLED !== "true") return NextResponse.json({error:"Marketplace checkout is not enabled."},{status:503,headers});
  const session=await createClient();const {data:{user},error:authError}=await session.auth.getUser();
  if(authError||!user||!user.email)return NextResponse.json({error:"Sign in with an email address to purchase."},{status:401,headers});
  const raw=await req.text();if(new TextEncoder().encode(raw).byteLength>4096)return NextResponse.json({error:"Request too large."},{status:413,headers});
  let body:unknown;try{body=JSON.parse(raw)}catch{return NextResponse.json({error:"Invalid JSON."},{status:400,headers})}
  if(!body||typeof body!=="object"||Array.isArray(body))return NextResponse.json({error:"Invalid request."},{status:400,headers});
  const value=body as Record<string,unknown>;const productId=String(value.productId??"");const providerId=value.provider;
  if(!uuid.test(productId)||!(providerId==="paystack"||providerId==="stripe"))return NextResponse.json({error:"Invalid product or payment provider."},{status:400,headers});
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw Error("Marketplace checkout service unavailable");
  const admin=adminClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
  const {data:p,error}=await admin.from("marketplace_products").select("id,slug,name,pricing_type,price_minor,currency,status,current_version_id,marketplace_product_versions!marketplace_products_current_version_fk(id,verification_status)").eq("id",productId).maybeSingle();
  if(error)throw error;if(!p||p.status!=="published"||p.pricing_type==="free"||!p.current_version_id)return NextResponse.json({error:"Product is not purchasable."},{status:404,headers});
  const version=Array.isArray(p.marketplace_product_versions)?p.marketplace_product_versions[0]:p.marketplace_product_versions;
  if(!version||version.id!==p.current_version_id||version.verification_status!=="approved")return NextResponse.json({error:"Current product version is not approved."},{status:409,headers});
  const amount=Number(p.price_minor);if(!Number.isSafeInteger(amount)||amount<50)return NextResponse.json({error:"Product price is invalid."},{status:409,headers});
  const {data:purchase,error:purchaseError}=await admin.from("marketplace_purchases").insert({buyer_user_id:user.id,product_id:p.id,product_version_id:p.current_version_id,provider:providerId,amount_minor:amount,currency:"USD",status:"pending"}).select("id").single();
  if(purchaseError)throw purchaseError;
  const origin=req.nextUrl.origin;const provider=getMarketplacePaymentProvider(providerId);
  const checkout=await provider.createCheckout({purchaseId:purchase.id,idempotencyKey:"aivanta-"+purchase.id,amountMinor:amount,currency:"USD",product:{id:p.id,slug:p.slug,name:p.name},versionId:p.current_version_id,buyerId:user.id,buyerEmail:user.email,successUrl:origin+"/marketplace/purchases?checkout=success",cancelUrl:origin+"/marketplace/"+p.slug});
  const {error:updateError}=await admin.from("marketplace_purchases").update({provider_checkout_id:checkout.providerCheckoutId}).eq("id",purchase.id).eq("status","pending");if(updateError)throw updateError;
  return NextResponse.json({checkoutUrl:checkout.checkoutUrl,purchaseId:purchase.id},{status:201,headers});
 }catch(e){console.error("Marketplace checkout failed",e);return NextResponse.json({error:"Could not start checkout. No purchase was confirmed."},{status:500,headers})}
}
