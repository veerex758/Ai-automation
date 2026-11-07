import {NextResponse,type NextRequest} from "next/server";
import {createClient} from "@/lib/supabase/server";
const headers={"Cache-Control":"private, no-store"};type Ctx={params:Promise<{productId:string}>};
export async function POST(_request:NextRequest,ctx:Ctx){
 try{const supabase=await createClient();const {data:{user},error:authError}=await supabase.auth.getUser();if(authError||!user)return NextResponse.json({error:"Authentication required."},{status:401,headers});
 const {productId}=await ctx.params;const {data:creator}=await supabase.from("marketplace_creators").select("status").eq("user_id",user.id).maybeSingle();if(!creator||creator.status!=="verified")return NextResponse.json({error:"Creator verification is required before submitting products."},{status:403,headers});
 const {data:product,error:productError}=await supabase.from("marketplace_products").select("id,created_by,status,current_version_id").eq("id",productId).eq("created_by",user.id).maybeSingle();if(productError||!product||!product.current_version_id)return NextResponse.json({error:"Product and a saved version are required."},{status:409,headers});
 const {data,error}=await supabase.rpc("submit_marketplace_product",{p_product_id:productId,p_version_id:product.current_version_id});if(error){console.error("Marketplace submission transition failed",error);return NextResponse.json({error:"Product could not be submitted. Check its draft status and version."},{status:409,headers});}
 return NextResponse.json({submission:data,message:"Submitted. Aivanta automated checks and human verification are required before publication."},{status:202,headers});
 }catch(e){console.error("Marketplace product submit failed",e);return NextResponse.json({error:"Could not submit product."},{status:500,headers});}
}
