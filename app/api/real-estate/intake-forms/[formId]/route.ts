import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store"};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Context={params:Promise<{formId:string}>};
function normalizeOrigin(value:string){try{const u=new URL(value);if(!["https:","http:"].includes(u.protocol)||u.username||u.password||u.origin!==value.replace(/\/$/,""))return null;if(u.protocol==="http:"&&!(u.hostname==="localhost"||u.hostname==="127.0.0.1"))return null;return u.origin;}catch{return null;}}
export async function PATCH(request:NextRequest,context:Context){
 try{const {formId}=await context.params;if(!uuid.test(formId))return NextResponse.json({error:"Invalid form ID."},{status:400,headers});
 const supabase=await createClient();const {data:{user},error:authError}=await supabase.auth.getUser();if(authError||!user)return NextResponse.json({error:"Authentication required."},{status:401,headers});
 const workspace=await getOrCreateDefaultWorkspace(supabase),raw=await request.text();if(Buffer.byteLength(raw,"utf8")>8000)return NextResponse.json({error:"Form update exceeds 8 KiB."},{status:413,headers});
 let body:unknown;try{body=JSON.parse(raw)}catch{return NextResponse.json({error:"Invalid JSON."},{status:400,headers});}
 if(!body||typeof body!=="object"||Array.isArray(body))return NextResponse.json({error:"Update must be an object."},{status:400,headers});
 const b=body as Record<string,unknown>,update:Record<string,unknown>={};
 if("enabled"in b){if(typeof b.enabled!=="boolean")return NextResponse.json({error:"Enabled must be true or false."},{status:400,headers});update.enabled=b.enabled;}
 if("name"in b){if(typeof b.name!=="string"||!b.name.trim()||b.name.trim().length>120)return NextResponse.json({error:"Invalid form name."},{status:400,headers});update.name=b.name.trim();}
 if("allowedOrigins"in b){if(!Array.isArray(b.allowedOrigins)||b.allowedOrigins.length<1||b.allowedOrigins.length>30||b.allowedOrigins.some(x=>typeof x!=="string"))return NextResponse.json({error:"Provide 1–30 allowed origins."},{status:400,headers});const origins=[...new Set((b.allowedOrigins as string[]).map(normalizeOrigin))];if(origins.some(x=>!x))return NextResponse.json({error:"Use exact HTTPS origins (HTTP only for localhost)."},{status:400,headers});update.allowed_origins=origins;}
 if(!Object.keys(update).length)return NextResponse.json({error:"No form changes supplied."},{status:400,headers});
 const {data,error}=await supabase.from("real_estate_intake_forms").update(update).eq("id",formId).eq("workspace_id",workspace.id).select("id,name,default_source,allowed_origins,enabled,updated_at").maybeSingle();
 if(error)throw error;if(!data)return NextResponse.json({error:"Form not found or workspace owner permission required."},{status:404,headers});
 return NextResponse.json({form:data},{headers});
 }catch(error){console.error("Intake form update failed",error);return NextResponse.json({error:"Could not update intake form."},{status:500,headers});}
}
