import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const cleanText = (value: unknown, max: number) => typeof value === "string" && value.trim() ? value.trim().slice(0,max) : null;
const types = ["apartment","house","land","commercial","other"];
const transactions = ["sale","rent"];
const statuses = ["available","pending","sold","rented","withdrawn"];
function parseProperty(body: Record<string, unknown>) {
  const reference = cleanText(body.reference,100), title = cleanText(body.title,200), location = cleanText(body.location,200);
  const propertyType = cleanText(body.propertyType,30), transactionType = cleanText(body.transactionType,20);
  const price = Number(body.price), currency = (cleanText(body.currency,3) ?? "USD").toUpperCase();
  if (!reference || !title || !location || !propertyType || !types.includes(propertyType) || !transactionType || !transactions.includes(transactionType)) throw new Error("Reference, title, location, property type and transaction type are required.");
  if (!Number.isFinite(price) || price <= 0 || price > 1e12 || !/^[A-Z]{3}$/.test(currency)) throw new Error("Enter a valid price and three-letter currency code.");
  const availabilityStatus = statuses.includes(String(body.availabilityStatus)) ? String(body.availabilityStatus) : "available";
  const bedrooms = body.bedrooms === null || body.bedrooms === undefined || body.bedrooms === "" ? null : Number(body.bedrooms);
  const bathrooms = body.bathrooms === null || body.bathrooms === undefined || body.bathrooms === "" ? null : Number(body.bathrooms);
  const area = body.areaSqm === null || body.areaSqm === undefined || body.areaSqm === "" ? null : Number(body.areaSqm);
  if (bedrooms !== null && (!Number.isInteger(bedrooms) || bedrooms < 0 || bedrooms > 50)) throw new Error("Bedrooms must be an integer between 0 and 50.");
  if (bathrooms !== null && (!Number.isFinite(bathrooms) || bathrooms < 0 || bathrooms > 50)) throw new Error("Bathrooms must be between 0 and 50.");
  if (area !== null && (!Number.isFinite(area) || area <= 0 || area > 1e9)) throw new Error("Area must be a positive number.");
  return {
    reference,title,description:cleanText(body.description,6000) ?? "",property_type:propertyType,
    transaction_type:transactionType,location,address:cleanText(body.address,300),price,currency,bedrooms,bathrooms,area_sqm:area,
    listing_url:cleanText(body.listingUrl,2000),availability_status:availabilityStatus,
    available:availabilityStatus === "available",last_verified_at:new Date().toISOString(),
    attributes:isRecord(body.attributes)?body.attributes:{},
  };
}
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient(); const {data:{user},error:authError}=await supabase.auth.getUser();
    if(authError||!user)return NextResponse.json({error:"Authentication required."},{status:401,headers});
    const workspace=await getOrCreateDefaultWorkspace(supabase);
    const params=request.nextUrl.searchParams, q=(params.get("q")??"").trim().slice(0,100);
    let query=supabase.from("real_estate_properties").select("id,reference,title,property_type,transaction_type,location,price,currency,bedrooms,bathrooms,availability_status,available,last_verified_at,listing_url,updated_at",{count:"exact"})
      .eq("workspace_id",workspace.id).order("updated_at",{ascending:false}).limit(100);
    if(params.get("available")==="true")query=query.eq("available",true);
    if(q)query=query.ilike("title","%"+q.replace(/[%_]/g,"\\$&")+"%");
    const {data,error,count}=await query;if(error)throw error;
    return NextResponse.json({properties:data??[],total:count??0},{headers});
  } catch(error){console.error("Property list failed",error);return NextResponse.json({error:"Could not load properties."},{status:500,headers});}
}
export async function POST(request: NextRequest) {
  try {
    const supabase=await createClient();const {data:{user},error:authError}=await supabase.auth.getUser();
    if(authError||!user)return NextResponse.json({error:"Authentication required."},{status:401,headers});
    const raw=await request.text();if(Buffer.byteLength(raw,"utf8")>16000)return NextResponse.json({error:"Property input exceeds 16 KiB."},{status:413,headers});
    let body:unknown;try{body=JSON.parse(raw)}catch{return NextResponse.json({error:"Invalid JSON."},{status:400,headers});}
    if(!isRecord(body))return NextResponse.json({error:"Property input must be an object."},{status:400,headers});
    const input=parseProperty(body);const workspace=await getOrCreateDefaultWorkspace(supabase);
    const {data,error}=await supabase.from("real_estate_properties").insert({...input,workspace_id:workspace.id,created_by:user.id})
      .select("*").single();
    if(error)throw error;
    return NextResponse.json({property:data},{status:201,headers});
  } catch(error){const message=error instanceof Error?error.message:"";if(/required|valid|Enter|must be/.test(message))return NextResponse.json({error:message},{status:400,headers});console.error("Property create failed",error);return NextResponse.json({error:"Could not create property listing."},{status:500,headers});}
}
