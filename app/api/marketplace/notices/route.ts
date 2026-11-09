import {NextResponse,type NextRequest} from "next/server";
import {createClient} from "@/lib/supabase/server";
const headers={"Cache-Control":"private, no-store"};
export async function GET(){const sb=await createClient();const {data:{user},error:authError}=await sb.auth.getUser();if(authError||!user)return NextResponse.json({error:"Authentication required."},{status:401,headers});
 const {data,error}=await sb.from("marketplace_customer_notices").select("id,product_id,installation_id,notice_type,title,body,action_url,read_at,created_at").eq("user_id",user.id).order("created_at",{ascending:false}).limit(100);
 if(error)return NextResponse.json({error:"Could not load marketplace notices."},{status:500,headers});return NextResponse.json({notices:data??[]},{headers});}
export async function PATCH(request:NextRequest){const sb=await createClient();const {data:{user},error:authError}=await sb.auth.getUser();if(authError||!user)return NextResponse.json({error:"Authentication required."},{status:401,headers});
 const raw=await request.text();if(new TextEncoder().encode(raw).byteLength>1000)return NextResponse.json({error:"Request too large."},{status:413,headers});let b:Record<string,unknown>;try{b=JSON.parse(raw)}catch{return NextResponse.json({error:"Invalid JSON."},{status:400,headers})}
 if(typeof b.id!=="string"||!/^[0-9a-f-]{36}$/i.test(b.id))return NextResponse.json({error:"Valid notice id required."},{status:400,headers});
 const {data,error}=await sb.from("marketplace_customer_notices").update({read_at:new Date().toISOString()}).eq("id",b.id).eq("user_id",user.id).select("id,read_at").maybeSingle();if(error)return NextResponse.json({error:"Could not update notice."},{status:500,headers});if(!data)return NextResponse.json({error:"Notice not found."},{status:404,headers});return NextResponse.json({notice:data},{headers});}
