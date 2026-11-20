import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
import { matchRealEstateProperties } from "@/lib/real-estate/lead-scoring";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store"};
type Context={params:Promise<{leadId:string}>};
export async function GET(_request:NextRequest,context:Context){
 try{
  const {leadId}=await context.params;const supabase=await createClient();const {data:{user},error:authError}=await supabase.auth.getUser();
  if(authError||!user)return NextResponse.json({error:"Authentication required."},{status:401,headers});
  const workspace=await getOrCreateDefaultWorkspace(supabase);
  const {data:lead,error:leadError}=await supabase.from("real_estate_leads").select("id,transaction_type,property_type,preferred_location,budget_min,budget_max,currency,bedrooms").eq("id",leadId).eq("workspace_id",workspace.id).maybeSingle();
  if(leadError)throw leadError;if(!lead)return NextResponse.json({error:"Lead not found."},{status:404,headers});
  const {data:properties,error}=await supabase.from("real_estate_properties").select("id,title,property_type,transaction_type,location,price,currency,bedrooms,availability_status,available,last_verified_at").eq("workspace_id",workspace.id).eq("available",true).eq("availability_status","available").order("updated_at",{ascending:false}).limit(500);
  if(error)throw error;
  const matches=matchRealEstateProperties({transactionType:lead.transaction_type,propertyType:lead.property_type,preferredLocation:lead.preferred_location,budgetMin:lead.budget_min===null?null:Number(lead.budget_min),budgetMax:lead.budget_max===null?null:Number(lead.budget_max),currency:lead.currency,bedrooms:lead.bedrooms},(properties??[]).map(p=>({...p,price:Number(p.price)})));
  return NextResponse.json({leadId,matches,checkedListings:properties?.length??0,availabilityVerifiedAt:new Date().toISOString()},{headers});
 }catch(error){console.error("Property matching failed",error);return NextResponse.json({error:"Could not match properties for this lead."},{status:500,headers});}
}
