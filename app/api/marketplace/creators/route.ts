import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
const headers={"Cache-Control":"private, no-store"};
export async function GET(){
 try{const supabase=await createClient();const {data:{user}}=await supabase.auth.getUser();if(!user)return NextResponse.json({error:"Authentication required."},{status:401,headers});
 const {data,error}=await supabase.from("marketplace_creators").select("id,display_name,slug,bio,status,created_at").eq("user_id",user.id).maybeSingle();if(error)throw error;return NextResponse.json({creator:data},{headers});
 }catch(e){console.error("Creator profile lookup failed",e);return NextResponse.json({error:"Could not load creator profile."},{status:500,headers});}
}
export async function POST(request:NextRequest){
 try{const supabase=await createClient();const {data:{user},error:authError}=await supabase.auth.getUser();if(authError||!user)return NextResponse.json({error:"Authentication required."},{status:401,headers});
 const raw=await request.text();if(new TextEncoder().encode(raw).byteLength>8192)return NextResponse.json({error:"Request too large."},{status:413,headers});let body:Record<string,unknown>;try{body=JSON.parse(raw)}catch{return NextResponse.json({error:"Invalid JSON."},{status:400,headers});}
 const displayName=typeof body.display_name==="string"?body.display_name.trim():"";const slug=typeof body.slug==="string"?body.slug.trim().toLowerCase():"";const bio=typeof body.bio==="string"?body.bio.trim():"";
 if(displayName.length<2||displayName.length>100)return NextResponse.json({error:"Display name must be 2–100 characters."},{status:400,headers});
 if(!/^[a-z0-9-]{3,120}$/.test(slug))return NextResponse.json({error:"Creator URL must be 3–120 lowercase letters, numbers, or hyphens."},{status:400,headers});
 if(bio.length>1000)return NextResponse.json({error:"Bio cannot exceed 1,000 characters."},{status:400,headers});
 const {data,error}=await supabase.from("marketplace_creators").insert({user_id:user.id,display_name:displayName,slug,bio,status:"pending"}).select("id,display_name,slug,bio,status").single();
 if(error){if(error.code==="23505")return NextResponse.json({error:"That creator URL or account is already registered."},{status:409,headers});throw error;}
 return NextResponse.json({creator:data,message:"Creator profile submitted. Aivanta verification is required before paid publishing."},{status:201,headers});
 }catch(e){console.error("Creator onboarding failed",e);return NextResponse.json({error:"Could not create creator profile."},{status:500,headers});}
}
