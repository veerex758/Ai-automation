import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store"};
function normalizeOrigin(value:string){try{const u=new URL(value);if(!["https:","http:"].includes(u.protocol)||u.username||u.password||u.origin!==value.replace(/\/$/,""))return null;if(u.protocol==="http:"&&!(u.hostname==="localhost"||u.hostname==="127.0.0.1"))return null;return u.origin;}catch{return null;}}
export async function GET(){
 try{const supabase=await createClient();const {data:{user},error:authError}=await supabase.auth.getUser();if(authError||!user)return NextResponse.json({error:"Authentication required."},{status:401,headers});
 const workspace=await getOrCreateDefaultWorkspace(supabase);const {data,error}=await supabase.from("real_estate_intake_forms").select("id,name,default_source,allowed_origins,enabled,created_at,updated_at").eq("workspace_id",workspace.id).order("created_at",{ascending:false});
 if(error)throw error;return NextResponse.json({forms:data??[]},{headers});
 }catch(error){console.error("Intake form list failed",error);return NextResponse.json({error:"Could not load intake forms."},{status:500,headers});}
}
export async function POST(request:NextRequest){
 try{const supabase=await createClient();const {data:{user},error:authError}=await supabase.auth.getUser();if(authError||!user)return NextResponse.json({error:"Authentication required."},{status:401,headers});
 const raw=await request.text();if(Buffer.byteLength(raw,"utf8")>8000)return NextResponse.json({error:"Form configuration exceeds 8 KiB."},{status:413,headers});
 let body:unknown;try{body=JSON.parse(raw)}catch{return NextResponse.json({error:"Invalid JSON."},{status:400,headers});}
 if(!body||typeof body!=="object"||Array.isArray(body))return NextResponse.json({error:"Form configuration must be an object."},{status:400,headers});
 const b=body as Record<string,unknown>,name=typeof b.name==="string"?b.name.trim():"",source=typeof b.defaultSource==="string"?b.defaultSource.trim():"website";
 if(!name||name.length>120)return NextResponse.json({error:"Form name must be 1–120 characters."},{status:400,headers});
 if(!/^[a-zA-Z0-9_-]{1,80}$/.test(source))return NextResponse.json({error:"Source must contain only letters, numbers, underscores or hyphens."},{status:400,headers});
 if(!Array.isArray(b.allowedOrigins)||b.allowedOrigins.length<1||b.allowedOrigins.length>30||b.allowedOrigins.some(x=>typeof x!=="string"))return NextResponse.json({error:"Add between 1 and 30 allowed website origins."},{status:400,headers});
 const origins=[...new Set((b.allowedOrigins as string[]).map(normalizeOrigin))];if(origins.some(x=>!x))return NextResponse.json({error:"Each allowed origin must be an exact HTTPS origin (HTTP is allowed only for localhost). Include scheme and host, not a page path."},{status:400,headers});
 const workspace=await getOrCreateDefaultWorkspace(supabase),publicKey=randomBytes(32).toString("base64url");
 const {data,error}=await supabase.from("real_estate_intake_forms").insert({workspace_id:workspace.id,name,default_source:source,allowed_origins:origins,public_key_hash:(await import("node:crypto")).createHash("sha256").update(publicKey).digest("hex"),enabled:true,created_by:user.id})
 .select("id,name,default_source,allowed_origins,enabled,created_at").single();
 if(error)throw error;
 return NextResponse.json({form:data,publicKey,endpoint:"/api/real-estate/intake/"+publicKey,secretShownOnce:true,exampleFetch:"fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ fullName, email, phone, transactionType, propertyType, preferredLocation, budgetMin, budgetMax, currency, timeframe, consentToContact }) })"},{status:201,headers});
 }catch(error){console.error("Intake form create failed",error);return NextResponse.json({error:"Could not create intake form."},{status:500,headers});}
}
