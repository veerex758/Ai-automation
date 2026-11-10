import {NextResponse,type NextRequest} from "next/server";
import {createClient as createAdmin} from "@supabase/supabase-js";
import {createClient} from "@/lib/supabase/server";
const h={"Cache-Control":"private, no-store"};
function admin(){const u=process.env.NEXT_PUBLIC_SUPABASE_URL??process.env.NEXT_PUBLIC_CODED_SUPABASE_URL,k=process.env.SUPABASE_SERVICE_ROLE_KEY??process.env.CODED_SUPABASE_SERVICE_ROLE_KEY;if(!u||!k)throw Error("Creator team service unavailable");return createAdmin(u,k,{auth:{autoRefreshToken:false,persistSession:false}})}
export async function GET(){const s=await createClient();const {data:{user},error}=await s.auth.getUser();if(error||!user)return NextResponse.json({error:"Authentication required."},{status:401,headers:h});
 const a=admin();const {data:creator}=await a.from("marketplace_creators").select("id,status").eq("user_id",user.id).maybeSingle();if(!creator)return NextResponse.json({error:"Creator profile required."},{status:403,headers:h});
 const {data:owned,error:oe}=await a.from("marketplace_creator_teams").select("id,name,slug,status,created_at").eq("owner_creator_id",creator.id);
 const {data:member,error:me}=await a.from("marketplace_creator_team_members").select("team_id,role,invitation_status,joined_at,team:marketplace_creator_teams(id,name,slug,status)").eq("user_id",user.id);
 if(oe||me)return NextResponse.json({error:"Could not load creator teams."},{status:500,headers:h});return NextResponse.json({owned:owned??[],memberships:member??[]},{headers:h})}
export async function POST(req:NextRequest){const s=await createClient();const {data:{user},error}=await s.auth.getUser();if(error||!user)return NextResponse.json({error:"Authentication required."},{status:401,headers:h});
 const raw=await req.text();if(new TextEncoder().encode(raw).byteLength>3000)return NextResponse.json({error:"Request too large."},{status:413,headers:h});let b:Record<string,unknown>;try{b=JSON.parse(raw)}catch{return NextResponse.json({error:"Invalid JSON."},{status:400,headers:h})}
 const name=typeof b.name==="string"?b.name.trim():"",slug=typeof b.slug==="string"?b.slug.trim().toLowerCase():"";if(name.length<2||name.length>120||!/^[a-z0-9-]{2,120}$/.test(slug))return NextResponse.json({error:"Team name (2–120) and slug (2–120 lowercase letters, numbers or hyphens) required."},{status:400,headers:h});
 const a=admin();const {data:c}=await a.from("marketplace_creators").select("id,status").eq("user_id",user.id).maybeSingle();if(!c||c.status!=="verified")return NextResponse.json({error:"Verified creator status is required to create an agency team."},{status:403,headers:h});
 const {data:team,error:te}=await a.from("marketplace_creator_teams").insert({owner_creator_id:c.id,name,slug}).select("id,name,slug,status,created_at").single();if(te){if(te.code==="23505")return NextResponse.json({error:"You already use this team slug."},{status:409,headers:h});return NextResponse.json({error:"Could not create creator team."},{status:500,headers:h})}
 const {error:memberError}=await a.from("marketplace_creator_team_members").insert({team_id:team.id,user_id:user.id,role:"admin",invited_by:user.id});if(memberError)return NextResponse.json({error:"Team created but owner membership could not be recorded; contact support."},{status:500,headers:h});
 await a.from("marketplace_admin_audit").insert({actor_id:user.id,action:"creator_team_created",entity_type:"creator_team",entity_id:team.id,details:{slug}});
 return NextResponse.json({team},{status:201,headers:h})}
