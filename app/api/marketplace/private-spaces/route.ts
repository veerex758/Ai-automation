/* eslint-disable @typescript-eslint/no-explicit-any */
import {NextRequest,NextResponse} from "next/server";
import {createClient as adminClient} from "@supabase/supabase-js";
import {createClient} from "@/lib/supabase/server";
const h={"Cache-Control":"private, no-store"},uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function slugify(s:string){return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,80)}
function admin(){const u=process.env.NEXT_PUBLIC_SUPABASE_URL,k=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!u||!k)throw new Error("service_unavailable");return adminClient(u,k,{auth:{autoRefreshToken:false,persistSession:false}})}
export async function GET(){
 try{const sb=await createClient(),{data:{user},error}=await sb.auth.getUser();if(error||!user)return NextResponse.json({error:"Authentication required."},{status:401,headers:h});
 const db=admin(),{data,error:e}=await db.from("marketplace_private_space_members").select("role,space:marketplace_private_spaces(id,name,slug,workspace_id,status,created_at)").eq("user_id",user.id);if(e)throw e;return NextResponse.json({spaces:(data??[]).filter(x=>(x.space as any)?.status==="active")},{headers:h});
 }catch(e){console.error("Private marketplaces read failed",e);return NextResponse.json({error:"Could not load private marketplaces."},{status:500,headers:h})}
}
export async function POST(req:NextRequest){
 try{const sb=await createClient(),{data:{user},error}=await sb.auth.getUser();if(error||!user)return NextResponse.json({error:"Authentication required."},{status:401,headers:h});
 const raw=await req.text();if(raw.length>2048)return NextResponse.json({error:"Request too large."},{status:413,headers:h});let b:unknown;try{b=JSON.parse(raw)}catch{return NextResponse.json({error:"Invalid JSON."},{status:400,headers:h})}
 if(!b||typeof b!=="object"||Array.isArray(b))return NextResponse.json({error:"Invalid request."},{status:400,headers:h});const x=b as Record<string,unknown>,workspaceId=String(x.workspaceId??""),name=String(x.name??"").trim().slice(0,120),slug=slugify(String(x.slug??name));
 if(!uuid.test(workspaceId)||name.length<2||slug.length<2)return NextResponse.json({error:"Workspace, name and valid slug required."},{status:400,headers:h});
 const db=admin(),{data:member,error:me}=await db.from("workspace_members").select("role").eq("workspace_id",workspaceId).eq("user_id",user.id).maybeSingle();if(me)throw me;if(!member||!["owner","admin"].includes(member.role))return NextResponse.json({error:"Workspace owner/admin access required."},{status:403,headers:h});
 const {data:space,error:se}=await db.from("marketplace_private_spaces").insert({owner_user_id:user.id,workspace_id:workspaceId,name,slug}).select("id,name,slug,workspace_id,status,created_at").single();if(se)throw se;
 const {error:ie}=await db.from("marketplace_private_space_members").insert({space_id:space.id,user_id:user.id,role:"manager",granted_by:user.id});if(ie){await db.from("marketplace_private_spaces").delete().eq("id",space.id);throw ie}
 return NextResponse.json({space},{status:201,headers:h});
 }catch(e){console.error("Private marketplace create failed",e);return NextResponse.json({error:"Could not create private marketplace."},{status:400,headers:h})}
}
