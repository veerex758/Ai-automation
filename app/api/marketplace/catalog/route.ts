import {NextResponse,type NextRequest} from "next/server";
import {createClient} from "@/lib/supabase/server";

const headers={"Cache-Control":"public, max-age=60, stale-while-revalidate=300"};
const types=["workflow","pack","agent"] as const;
const sorts=["recent","price_low","price_high","name"] as const;

export async function GET(request:NextRequest){
 const params=request.nextUrl.searchParams;
 const q=(params.get("q")??"").replace(/[^\p{L}\p{N}\s_-]/gu," ").replace(/\s+/g," ").trim().slice(0,80);
 const category=(params.get("category")??"").trim().slice(0,80);
 const type=types.includes(params.get("type") as typeof types[number])?params.get("type"):"";
 const pricing=["free","paid"].includes(params.get("pricing")??"")?params.get("pricing"):"";
 const sort=sorts.includes(params.get("sort") as typeof sorts[number])?params.get("sort"):"recent";
 const page=Math.max(1,Math.min(10000,Number.parseInt(params.get("page")??"1",10)||1));
 const pageSize=Math.max(1,Math.min(60,Number.parseInt(params.get("pageSize")??"24",10)||24));
 try{
  const sb=await createClient();
  let query=sb.from("marketplace_products").select("id,slug,name,summary,product_type,pricing_type,recurring_interval,price_minor,currency,published_at,category:marketplace_categories(name,slug),creator:marketplace_creators(display_name,slug)",{count:"exact"}).eq("status","published");
  if(q)query=query.or(`name.ilike.%${q}%,summary.ilike.%${q}%`);
  if(category)query=query.eq("category.slug",category);
  if(type)query=query.eq("product_type",type);
  if(pricing==="free")query=query.eq("pricing_type","free");
  if(pricing==="paid")query=query.neq("pricing_type","free");
  if(sort==="price_low")query=query.order("price_minor",{ascending:true}).order("published_at",{ascending:false});
  else if(sort==="price_high")query=query.order("price_minor",{ascending:false}).order("published_at",{ascending:false});
  else if(sort==="name")query=query.order("name",{ascending:true});
  else query=query.order("published_at",{ascending:false});
  const {data,error,count}=await query.range((page-1)*pageSize,page*pageSize-1);
  if(error)throw error;
  return NextResponse.json({products:data??[],pagination:{page,pageSize,total:count??0,totalPages:Math.ceil((count??0)/pageSize),hasNext:(count??0)>page*pageSize,hasPrevious:page>1}},{headers});
 }catch(error){console.error("Marketplace catalog API failed",error);return NextResponse.json({error:"Marketplace catalog is temporarily unavailable."},{status:500,headers:{"Cache-Control":"no-store"}});}
}
