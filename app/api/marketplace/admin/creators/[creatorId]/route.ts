import {NextResponse,type NextRequest} from "next/server";
import {createClient as adminClient} from "@supabase/supabase-js";
import {createClient} from "@/lib/supabase/server";
const h={"Cache-Control":"private, no-store"};type Ctx={params:Promise<{creatorId:string}>};
export async function POST(req:NextRequest,ctx:Ctx){
 try{const session=await createClient();const {data:{user},error}=await session.auth.getUser();if(error||!user)return NextResponse.json({error:"Authentication required."},{status:401,headers:h});
 const ids=(process.env.AIVANTA_MARKETPLACE_REVIEWER_IDS??"").split(",").map(x=>x.trim());if(!ids.includes(user.id))return NextResponse.json({error:"Marketplace reviewer access required."},{status:403,headers:h});
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw Error("Admin service not configured");const sb=adminClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
 const {creatorId}=await ctx.params;if(!/^[0-9a-f-]{36}$/i.test(creatorId))return NextResponse.json({error:"Invalid creator id."},{status:400,headers:h});
 const raw=await req.text();if(new TextEncoder().encode(raw).byteLength>2048)return NextResponse.json({error:"Request too large."},{status:413,headers:h});
 let parsed:unknown;try{parsed=JSON.parse(raw)}catch{return NextResponse.json({error:"Invalid JSON."},{status:400,headers:h})}
 if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))return NextResponse.json({error:"Invalid request body."},{status:400,headers:h});
 const body=parsed as Record<string,unknown>;const action=body.action;
 if(!["verify","suspend","reinstate"].includes(String(action)))return NextResponse.json({error:"Action must be verify, suspend, or reinstate."},{status:400,headers:h});
 const {data:result,error:moderationError}=await sb.rpc("marketplace_moderate_creator",{p_creator_id:creatorId,p_actor_id:user.id,p_action:action,p_notes:typeof body.notes==="string"?body.notes.slice(0,1000):""});
 if(moderationError){if(moderationError.message.includes("creator_not_found"))return NextResponse.json({error:"Creator not found."},{status:404,headers:h});if(moderationError.message.includes("creator_not_suspended")||moderationError.message.includes("suspended_creator_cannot_be_verified"))return NextResponse.json({error:"Creator status does not allow this action."},{status:409,headers:h});throw moderationError;}
 return NextResponse.json({creator:result},{headers:h});
 }catch(e){console.error("Creator moderation failed",e);return NextResponse.json({error:"Creator moderation failed."},{status:500,headers:h})}
}
