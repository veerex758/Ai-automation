import {NextResponse,type NextRequest} from "next/server";
import {createClient} from "@/lib/supabase/server";

const headers={"Cache-Control":"public, max-age=60, stale-while-revalidate=300"};
export async function GET(request:NextRequest){
 const p=request.nextUrl.searchParams;
 const q=(p.get("q")??"").replace(/[^\p{L}\p{N}\s_-]/gu," ").replace(/\s+/g," ").trim().slice(0,80);
 const page=Math.max(1,Math.min(10000,Number.parseInt(p.get("page")??"1",10)||1));
 const pageSize=Math.max(1,Math.min(40,Number.parseInt(p.get("pageSize")??"12",10)||12));
 try{
  const sb=await createClient();
  let query=sb.from("marketplace_bundles").select("id,slug,title,description,pricing_type,price_minor,currency,published_at,creator:marketplace_creators(display_name,slug),items:marketplace_bundle_items(product_id,product_version_id,position,product:marketplace_products(id,slug,name,summary,product_type,status,current_version_id,version:marketplace_product_versions(id,verification_status,version)))",{count:"exact"}).eq("status","published").order("published_at",{ascending:false});
  if(q)query=query.or(`title.ilike.%${q}%,description.ilike.%${q}%`);
  const {data,error,count}=await query.range((page-1)*pageSize,page*pageSize-1);
  if(error)throw error;
  // Fail closed: never expose a bundle containing an unapproved or stale item version.
  const bundles=(data??[]).filter((b:any)=>Array.isArray(b.items)&&b.items.length>0&&b.items.every((i:any)=>i.product?.status==="published"&&i.product?.current_version_id===i.product_version_id&&i.product?.version?.id===i.product_version_id&&i.product?.version?.verification_status==="approved")).map((b:any)=>({...b,items:b.items.map(({product_version_id,...i}:any)=>i)}));
  return NextResponse.json({bundles,pagination:{page,pageSize,total:count??0,totalPages:Math.ceil((count??0)/pageSize),hasNext:(count??0)>page*pageSize,hasPrevious:page>1}},{headers});
 }catch(error){console.error("Marketplace bundle catalog failed",error);return NextResponse.json({error:"Marketplace bundles are temporarily unavailable."},{status:500,headers:{"Cache-Control":"no-store"}});}
}
