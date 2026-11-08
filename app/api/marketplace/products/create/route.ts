import {NextResponse,type NextRequest} from "next/server";
import {createClient} from "@/lib/supabase/server";
const headers={"Cache-Control":"private, no-store"};
export async function POST(request:NextRequest){
 try{const supabase=await createClient();const {data:{user},error:authError}=await supabase.auth.getUser();if(authError||!user)return NextResponse.json({error:"Authentication required."},{status:401,headers});
 const raw=await request.text();if(new TextEncoder().encode(raw).byteLength>12000)return NextResponse.json({error:"Request exceeds 12 KiB."},{status:413,headers});let b:Record<string,unknown>;try{b=JSON.parse(raw)}catch{return NextResponse.json({error:"Invalid JSON."},{status:400,headers});}
 const name=typeof b.name==="string"?b.name.trim():"",summary=typeof b.summary==="string"?b.summary.trim():"",slug=typeof b.slug==="string"?b.slug.trim().toLowerCase():"",categoryId=typeof b.category_id==="string"?b.category_id:"";
 const type=["workflow","pack","agent"].includes(String(b.product_type))?String(b.product_type):"";
 const pricing=["free","one_time","recurring"].includes(String(b.pricing_type))?String(b.pricing_type):"";
 const price=Number.isInteger(b.price_minor)?Number(b.price_minor):0;const interval=b.recurring_interval==="year"?"year":b.recurring_interval==="month"?"month":null;
 if(name.length<3||name.length>140||summary.length<10||summary.length>280||!/^[a-z0-9-]{3,160}$/.test(slug)||!categoryId||!type||!pricing)return NextResponse.json({error:"Complete name, summary, URL, category, type, and pricing."},{status:400,headers});
 if((pricing==="free"&&price!==0)||(pricing!=="free"&&price<100)||(pricing==="recurring"&&!interval))return NextResponse.json({error:"Free products are $0; paid products start at $1.00; recurring products require an interval."},{status:400,headers});
 const {data:creator,error:creatorError}=await supabase.from("marketplace_creators").select("id,status").eq("user_id",user.id).maybeSingle();if(creatorError||!creator)return NextResponse.json({error:"Create a creator profile first."},{status:409,headers});
 const {data,error}=await supabase.from("marketplace_products").insert({creator_id:creator.id,category_id:categoryId,slug,name,summary,description:typeof b.description==="string"?b.description.slice(0,20000):"",product_type:type,pricing_type:pricing,price_minor:price,currency:"USD",recurring_interval:pricing==="recurring"?interval:null,required_plan:["free","starter","pro","business","enterprise"].includes(String(b.required_plan))?b.required_plan:"free",integrations:Array.isArray(b.integrations)?b.integrations.slice(0,30):[],permissions:Array.isArray(b.permissions)?b.permissions.slice(0,30):[],expected_usage:b.expected_usage&&typeof b.expected_usage==="object"?b.expected_usage:{},created_by:user.id,status:"draft"}).select("id,slug,name,status").single();
 if(error){if(error.code==="23505")return NextResponse.json({error:"Product URL already exists."},{status:409,headers});throw error;}
 return NextResponse.json({product:data},{status:201,headers});
 }catch(e){console.error("Marketplace product draft failed",e);return NextResponse.json({error:"Could not create product draft."},{status:500,headers});}
}
