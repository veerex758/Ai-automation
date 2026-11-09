/* eslint-disable @typescript-eslint/no-explicit-any */
import {NextRequest,NextResponse} from "next/server";
import {createClient as adminClient} from "@supabase/supabase-js";
import {createClient} from "@/lib/supabase/server";
const h={"Cache-Control":"private, no-store"},uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9]{3}-[89ab][0-9]{3}-[0-9a-f]{12}$/i;
export async function POST(req:NextRequest){try{
 const s=await createClient(),{data:{user},error}=await s.auth.getUser();if(error||!user)return NextResponse.json({error:"Authentication required."},{status:401,headers:h});
 if(!(process.env.AIVANTA_MARKETPLACE_REVIEWER_IDS??"").split(",").map(x=>x.trim()).includes(user.id))return NextResponse.json({error:"Finance reviewer access required."},{status:403,headers:h});
 const raw=await req.text();if(raw.length>2048)return NextResponse.json({error:"Request too large."},{status:413,headers:h});let b:any;try{b=JSON.parse(raw)}catch{return NextResponse.json({error:"Invalid JSON."},{status:400,headers:h})}
 const id=String(b?.promotionId??""),event=String(b?.eventKey??""),amount=Number(b?.amountMinor),note=String(b?.note??"");if(!uuid.test(id)||event.trim().length<8||event.length>200||!Number.isSafeInteger(amount)||amount<1||note.trim().length<10||note.length>1000)return NextResponse.json({error:"Invalid refund request."},{status:400,headers:h});
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw Error("service_unavailable");const db=adminClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}}),{data,error:rpc}=await db.rpc("marketplace_refund_promotion",{p_promotion_id:id,p_event_key:event,p_amount_minor:amount,p_actor_id:user.id,p_note:note.trim()});if(rpc)throw rpc;return NextResponse.json({refund:data},{headers:h});
}catch(e){console.error("Promotion refund failed",e);return NextResponse.json({error:"Promotion refund could not be recorded."},{status:400,headers:h})}}
