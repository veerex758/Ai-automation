import {NextResponse,type NextRequest} from "next/server";
import {createClient} from "@/lib/supabase/server";
const headers={"Cache-Control":"private, no-store"};
type Ctx={params:Promise<{productId:string}>};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function GET(_request:NextRequest,ctx:Ctx){
 const {productId}=await ctx.params;if(!uuid.test(productId))return NextResponse.json({error:"Invalid product ID."},{status:400,headers});
 const sb=await createClient();const {data,error}=await sb.from("marketplace_product_reviews").select("id,rating,title,body,created_at,reviewer_id").eq("product_id",productId).eq("status","published").order("created_at",{ascending:false}).limit(100);
 if(error)return NextResponse.json({error:"Could not load customer reviews."},{status:500,headers});
 const {data:agg}=await sb.from("marketplace_product_reviews").select("rating").eq("product_id",productId).eq("status","published");
 const ratings=agg??[];return NextResponse.json({reviews:(data??[]).map(r=>({...r,reviewer_id:undefined})),summary:{count:ratings.length,average:ratings.length?Math.round(ratings.reduce((n,r)=>n+r.rating,0)/ratings.length*100)/100:null}},{headers});
}
export async function POST(request:NextRequest,ctx:Ctx){
 const {productId}=await ctx.params;if(!uuid.test(productId))return NextResponse.json({error:"Invalid product ID."},{status:400,headers});
 const sb=await createClient();const {data:{user},error:authError}=await sb.auth.getUser();if(authError||!user)return NextResponse.json({error:"Sign in to review this product."},{status:401,headers});
 const raw=await request.text();if(new TextEncoder().encode(raw).byteLength>5000)return NextResponse.json({error:"Review is too large."},{status:413,headers});
 let body:Record<string,unknown>;try{body=JSON.parse(raw)}catch{return NextResponse.json({error:"Invalid JSON."},{status:400,headers})}
 const rating=Number(body.rating),title=typeof body.title==="string"?body.title.trim():"",text=typeof body.body==="string"?body.body.trim():"";
 if(!Number.isInteger(rating)||rating<1||rating>5||title.length>120||text.length>2000)return NextResponse.json({error:"Rating must be 1–5; title max 120 and review max 2,000 characters."},{status:400,headers});
 const {data,error}=await sb.from("marketplace_product_reviews").insert({product_id:productId,reviewer_id:user.id,rating,title,body:text,status:"published"}).select("id,rating,title,body,created_at").single();
 if(error){if(error.code==="23505")return NextResponse.json({error:"You have already reviewed this product."},{status:409,headers});if(error.code==="42501")return NextResponse.json({error:"A purchase or installation is required before reviewing."},{status:403,headers});return NextResponse.json({error:"Could not submit review."},{status:500,headers})}
 return NextResponse.json({review:data},{status:201,headers});
}