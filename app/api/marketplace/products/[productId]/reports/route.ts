import {NextResponse,type NextRequest} from "next/server";
import {createClient} from "@/lib/supabase/server";
const headers={"Cache-Control":"private, no-store"};
type Ctx={params:Promise<{productId:string}>};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const categories=["abuse","ip","security","privacy","misrepresentation","other"];
export async function POST(request:NextRequest,ctx:Ctx){
 const {productId}=await ctx.params;if(!uuid.test(productId))return NextResponse.json({error:"Invalid product ID."},{status:400,headers});
 const sb=await createClient();const {data:{user},error:authError}=await sb.auth.getUser();if(authError||!user)return NextResponse.json({error:"Sign in to report this listing."},{status:401,headers});
 const raw=await request.text();if(new TextEncoder().encode(raw).byteLength>6000)return NextResponse.json({error:"Report is too large."},{status:413,headers});
 let body:Record<string,unknown>;try{body=JSON.parse(raw)}catch{return NextResponse.json({error:"Invalid JSON."},{status:400,headers})}
 const category=String(body.category??""),details=typeof body.details==="string"?body.details.trim():"";
 if(!categories.includes(category)||details.length<10||details.length>4000)return NextResponse.json({error:"Choose a report category and provide 10–4,000 characters of detail."},{status:400,headers});
 const {data,error}=await sb.from("marketplace_product_reports").insert({product_id:productId,reporter_id:user.id,category,details}).select("id,status,created_at").single();
 if(error){if(error.code==="23505")return NextResponse.json({error:"You already have an open report for this category."},{status:409,headers});if(error.code==="42501")return NextResponse.json({error:"This listing cannot be reported."},{status:404,headers});return NextResponse.json({error:"Could not submit report."},{status:500,headers})}
 return NextResponse.json({report:data,message:"Report submitted for marketplace review."},{status:201,headers});
}