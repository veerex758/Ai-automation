import {NextRequest,NextResponse} from "next/server";
import {createClient} from "@/lib/supabase/server";
const headers={"Cache-Control":"private, no-store"};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function POST(req:NextRequest){
 if(process.env.AIVANTA_MARKETPLACE_SANDBOX_CHECKOUT_ENABLED!=="true")return NextResponse.json({error:"Marketplace sandbox checkout is disabled."},{status:503,headers});
 const sb=await createClient(),{data:{user},error}=await sb.auth.getUser();if(error||!user)return NextResponse.json({error:"Authentication required."},{status:401,headers});
 const raw=await req.text();if(new TextEncoder().encode(raw).byteLength>2048)return NextResponse.json({error:"Request too large."},{status:413,headers});
 let b:unknown;try{b=JSON.parse(raw)}catch{return NextResponse.json({error:"Invalid JSON."},{status:400,headers})}
 if(!b||typeof b!=="object"||Array.isArray(b))return NextResponse.json({error:"Invalid sandbox checkout request."},{status:400,headers});
 const v=b as Record<string,unknown>,action=v.action,productId=v.productId,sessionId=v.sessionId,key=v.idempotencyKey;
 if(action==="initialize"){
  if(typeof productId!=="string"||!uuid.test(productId)||typeof key!=="string"||key.trim().length<8||key.length>128)return NextResponse.json({error:"Provide a product ID and 8–128 character idempotency key."},{status:400,headers});
  const {data,error}=await sb.rpc("marketplace_create_sandbox_checkout",{p_product_id:productId,p_idempotency_key:key.trim()});
  if(error)return NextResponse.json({error:"Sandbox checkout could not be initialized."},{status:409,headers});
  return NextResponse.json({sandboxSession:data},{status:201,headers});
 }
 if(action==="complete"){
  if(typeof sessionId!=="string"||!uuid.test(sessionId))return NextResponse.json({error:"Valid sandbox session ID required."},{status:400,headers});
  const {data,error}=await sb.rpc("marketplace_complete_sandbox_checkout",{p_session_id:sessionId});
  if(error)return NextResponse.json({error:"Sandbox session cannot be completed."},{status:409,headers});
  return NextResponse.json({sandboxSession:data,message:"Simulated checkout completed. No real payment or entitlement was created."},{headers});
 }
 return NextResponse.json({error:"Choose initialize or complete."},{status:400,headers});
}
