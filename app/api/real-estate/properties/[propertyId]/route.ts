import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store"};
type Context={params:Promise<{propertyId:string}>};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowed={property_type:["apartment","house","land","commercial","other"],transaction_type:["sale","rent"],availability_status:["available","pending","sold","rented","withdrawn"]} as const;
export async function PATCH(request:NextRequest,context:Context){
 try{
  const {propertyId}=await context.params;if(!uuid.test(propertyId))return NextResponse.json({error:"Invalid property ID."},{status:400,headers});
  const supabase=await createClient();const {data:{user},error:authError}=await supabase.auth.getUser();if(authError||!user)return NextResponse.json({error:"Authentication required."},{status:401,headers});
  const workspace=await getOrCreateDefaultWorkspace(supabase);const raw=await request.text();if(Buffer.byteLength(raw,"utf8")>16000)return NextResponse.json({error:"Update exceeds 16 KiB."},{status:413,headers});
  let body:unknown;try{body=JSON.parse(raw)}catch{return NextResponse.json({error:"Invalid JSON."},{status:400,headers});}
  if(!body||typeof body!=="object"||Array.isArray(body))return NextResponse.json({error:"Update must be an object."},{status:400,headers});
  const b=body as Record<string,unknown>,update:Record<string,unknown>={};
  const strings:Record<string,number>={reference:100,title:200,description:6000,location:200,address:300,listing_url:2000};
  for(const [key,max] of Object.entries(strings)){const apiKey=key==="listing_url"?"listingUrl":key;if(apiKey in b){const v=b[apiKey];if(v!==null&&(typeof v!=="string"||v.trim().length>max))return NextResponse.json({error:"Invalid "+apiKey+"."},{status:400,headers});update[key]=typeof v==="string"?v.trim():null;}}
  for(const key of ["property_type","transaction_type","availability_status"] as const){const apiKey=key==="property_type"?"propertyType":key==="transaction_type"?"transactionType":"availabilityStatus";if(apiKey in b){if(!allowed[key].includes(String(b[apiKey]) as never))return NextResponse.json({error:"Invalid "+apiKey+"."},{status:400,headers});update[key]=b[apiKey];}}
  if("price"in b){const n=Number(b.price);if(!Number.isFinite(n)||n<=0||n>1e12)return NextResponse.json({error:"Price must be positive."},{status:400,headers});update.price=n;}
  if("currency"in b){const c=String(b.currency).toUpperCase();if(!/^[A-Z]{3}$/.test(c))return NextResponse.json({error:"Currency must be a three-letter code."},{status:400,headers});update.currency=c;}
  if("bedrooms"in b){const n=b.bedrooms===null?null:Number(b.bedrooms);if(n!==null&&(!Number.isInteger(n)||n<0||n>50))return NextResponse.json({error:"Invalid bedroom count."},{status:400,headers});update.bedrooms=n;}
  if("bathrooms"in b){const n=b.bathrooms===null?null:Number(b.bathrooms);if(n!==null&&(!Number.isFinite(n)||n<0||n>50))return NextResponse.json({error:"Invalid bathroom count."},{status:400,headers});update.bathrooms=n;}
  if("areaSqm"in b){const n=b.areaSqm===null?null:Number(b.areaSqm);if(n!==null&&(!Number.isFinite(n)||n<=0))return NextResponse.json({error:"Invalid area."},{status:400,headers});update.area_sqm=n;}
  if("available"in b){if(typeof b.available!=="boolean")return NextResponse.json({error:"Availability must be boolean."},{status:400,headers});update.available=b.available;update.availability_status=b.available?"available":"withdrawn";}
  if("availability_status"in update)update.available=update.availability_status==="available";
  if(!Object.keys(update).length)return NextResponse.json({error:"No editable property fields supplied."},{status:400,headers});
  update.last_verified_at=new Date().toISOString();
  const {data,error}=await supabase.from("real_estate_properties").update(update).eq("id",propertyId).eq("workspace_id",workspace.id).select("*").maybeSingle();
  if(error)throw error;if(!data)return NextResponse.json({error:"Property not found."},{status:404,headers});
  return NextResponse.json({property:data},{headers});
 }catch(error){console.error("Property update failed",error);return NextResponse.json({error:"Could not update this property."},{status:500,headers});}
}
export async function DELETE(_request:NextRequest,context:Context){
 try{const {propertyId}=await context.params;if(!uuid.test(propertyId))return NextResponse.json({error:"Invalid property ID."},{status:400,headers});
  const supabase=await createClient();const {data:{user},error:authError}=await supabase.auth.getUser();if(authError||!user)return NextResponse.json({error:"Authentication required."},{status:401,headers});
  const workspace=await getOrCreateDefaultWorkspace(supabase);const {data,error}=await supabase.from("real_estate_properties").delete().eq("id",propertyId).eq("workspace_id",workspace.id).select("id").maybeSingle();
  if(error)throw error;if(!data)return NextResponse.json({error:"Property not found or workspace owner permission required."},{status:404,headers});
  return NextResponse.json({success:true},{headers});
 }catch(error){console.error("Property delete failed",error);return NextResponse.json({error:"Could not delete property."},{status:500,headers});}
}
