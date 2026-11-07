import { NextResponse,type NextRequest } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
const headers={"Cache-Control":"private, no-store"};
async function reviewer(){
 const session=await createClient();const {data:{user},error}=await session.auth.getUser();
 if(error||!user)return {status:401 as const};
 const allowed=(process.env.AIVANTA_MARKETPLACE_REVIEWER_IDS??"").split(",").map(x=>x.trim()).filter(Boolean);
 if(!allowed.includes(user.id))return {status:403 as const};
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)return {status:500 as const};
 return {status:200 as const,user,db:createAdmin(url,key,{auth:{autoRefreshToken:false,persistSession:false}})};
}
export async function GET(){
 try{const access=await reviewer();if(access.status!==200)return NextResponse.json({error:access.status===401?"Authentication required.":access.status===403?"Finance reviewer access required.":"Finance service unavailable."},{status:access.status,headers});
 const {data,error}=await access.db.from("marketplace_payout_requests").select("id,creator_id,amount_minor,currency,status,payout_provider,provider_transfer_id,requested_at,reviewed_at,processed_at,notes").order("requested_at",{ascending:false}).limit(200);
 if(error)throw error;return NextResponse.json({payouts:data??[]},{headers});
 }catch(error){console.error("Marketplace finance payout queue failed",error);return NextResponse.json({error:"Could not load payout queue."},{status:500,headers});}
}
export async function POST(request:NextRequest){
 try{const access=await reviewer();if(access.status!==200)return NextResponse.json({error:access.status===401?"Authentication required.":access.status===403?"Finance reviewer access required.":"Finance service unavailable."},{status:access.status,headers});
 const raw=await request.text();if(new TextEncoder().encode(raw).byteLength>4096)return NextResponse.json({error:"Request too large."},{status:413,headers});
 let body:unknown;try{body=JSON.parse(raw)}catch{return NextResponse.json({error:"Invalid JSON."},{status:400,headers})}
 if(!body||typeof body!=="object"||Array.isArray(body))return NextResponse.json({error:"Invalid request."},{status:400,headers});
 const input=body as Record<string,unknown>,id=input.payout_id,action=input.action,reason=input.reason,transfer=input.transfer_id;
 if(typeof id!=="string"||!/^[0-9a-f-]{36}$/i.test(id)||!["under_review","approve","reject","hold","processing","failed"].includes(String(action))||
 (reason!==undefined&&(typeof reason!=="string"||reason.length>1000)))return NextResponse.json({error:"Invalid payout action."},{status:400,headers});
 if(action==="processing"&&typeof transfer==="string"&&transfer.length>255)return NextResponse.json({error:"Invalid transfer reference."},{status:400,headers});
 const {data,error}=await access.db.rpc("marketplace_review_payout_request",{p_request_id:id,p_action:action,p_reason:typeof reason==="string"?reason.trim():"",p_transfer_id:typeof transfer==="string"?transfer.trim()||null:null});
 if(error){const status=/payout_request_not_found/.test(error.message)?404:/payout_transition_invalid/.test(error.message)?409:/invalid_payout_action/.test(error.message)?400:500;if(status===500)console.error("Finance payout action failed",error);return NextResponse.json({error:status===404?"Payout request not found.":status===409?"Payout status does not permit this action.":status===400?"Invalid payout action.":"Could not update payout."},{status,headers});}
 return NextResponse.json({payout:data},{headers});
 }catch(error){console.error("Finance payout action failed",error);return NextResponse.json({error:"Could not update payout."},{status:500,headers});}
}
