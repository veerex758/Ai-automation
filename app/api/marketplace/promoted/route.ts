/* eslint-disable @typescript-eslint/no-explicit-any */
import {NextResponse} from "next/server";
import {createClient as adminClient} from "@supabase/supabase-js";
export async function GET(){
 const headers={"Cache-Control":"public, max-age=30, stale-while-revalidate=120"};
 try{
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw new Error("marketplace_admin_unavailable");
  const db=adminClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}}),now=new Date().toISOString();
  const {data,error}=await db.from("marketplace_promotions").select("id,disclosure_label,starts_at,ends_at,product:marketplace_products(id,slug,name,summary,product_type,pricing_type,price_minor,currency,published_at,status,current_version_id,version:marketplace_product_versions(id,verification_status,version),creator:marketplace_creators(display_name,slug))").eq("status","active").lte("starts_at",now).gt("ends_at",now).order("starts_at",{ascending:false}).limit(12);
  if(error)throw error;
  const placements=(data??[]).filter((x:any)=>x.disclosure_label==="Sponsored"&&x.product?.status==="published"&&x.product?.version?.id===x.product?.current_version_id&&x.product?.version?.verification_status==="approved").map((x:any)=>({promotionId:x.id,disclosure:"Sponsored",startsAt:x.starts_at,endsAt:x.ends_at,product:x.product}));
  return NextResponse.json({placements,organicRankingUnaffected:true},{headers});
 }catch(e){console.error("Marketplace sponsored placements unavailable",e);return NextResponse.json({error:"Sponsored placements unavailable."},{status:500,headers:{"Cache-Control":"no-store"}})}
}
