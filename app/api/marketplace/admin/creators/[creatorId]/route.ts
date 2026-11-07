import {NextResponse,type NextRequest} from "next/server";
import {createClient as adminClient} from "@supabase/supabase-js";
import {createClient} from "@/lib/supabase/server";
const h={"Cache-Control":"private, no-store"};type Ctx={params:Promise<{creatorId:string}>};
export async function POST(req:NextRequest,ctx:Ctx){
 try{const session=await createClient();const {data:{user},error}=await session.auth.getUser();if(error||!user)return NextResponse.json({error:"Authentication required."},{status:401,headers:h});
 const ids=(process.env.AIVANTA_MARKETPLACE_REVIEWER_IDS??"").split(",").map(x=>x.trim());if(!ids.includes(user.id))return NextResponse.json({error:"Marketplace reviewer access required."},{status:403,headers:h});
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw Error("Admin service not configured");const sb=adminClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
 const {creatorId}=await ctx.params;if(!/^[0-9a-f-]{36}$/i.test(creatorId))return NextResponse.json({error:"Invalid creator id."},{status:400,headers:h});
 const raw=await req.text();if(new TextEncoder().encode(raw).byteLength>2048)return NextResponse.json({error:"Request too large."},{status:413,headers:h});let b:any;try{b=JSON.parse(raw)}catch{return NextResponse.json({error:"Invalid JSON."},{status:400,headers:h})}
 const status=b.action==="verify"?"verified":b.action==="suspend"?"suspended":b.action==="reinstate"?"pending":null;if(!status)return NextResponse.json({error:"Action must be verify, suspend, or reinstate."},{status:400,headers:h});
 const {data:before,error:be}=await sb.from("marketplace_creators").select("id,user_id,status,display_name").eq("id",creatorId).maybeSingle();if(be||!before)return NextResponse.json({error:"Creator not found."},{status:404,headers:h});
 const {data,error:ue}=await sb.from("marketplace_creators").update({status,updated_at:new Date().toISOString()}).eq("id",creatorId).select("id,status,display_name").single();if(error)throw error;
 const {error:ae}=await sb.from("marketplace_admin_audit").insert({actor_id:user.id,action:"creator_"+b.action,entity_type:"creator",entity_id:creatorId,details:{from:before.status,to:status,notes:typeof b.notes==="string"?b.notes.slice(0,1000):""}});if(ae)throw ae;
 return NextResponse.json({creator:ue},{headers:h});
 }catch(e){console.error("Creator moderation failed",e);return NextResponse.json({error:"Creator moderation failed."},{status:500,headers:h})}
}
