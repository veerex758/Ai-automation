import {NextResponse,type NextRequest} from "next/server";
import {createClient} from "@/lib/supabase/server";
import {getOrCreateDefaultWorkspace} from "@/lib/supabase/workspace";
const headers={"Cache-Control":"private, no-store"};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Context={params:Promise<{productId:string}>};
export async function POST(_request:NextRequest,context:Context){
 try{
  const supabase=await createClient();
  const {data:{user},error:authError}=await supabase.auth.getUser();
  if(authError||!user)return NextResponse.json({error:"Authentication required."},{status:401,headers});
  const {productId}=await context.params;
  if(!uuid.test(productId))return NextResponse.json({error:"Invalid product ID."},{status:400,headers});
  const workspace=await getOrCreateDefaultWorkspace(supabase);
  const {data,error}=await supabase.rpc("marketplace_install_product",{p_product_id:productId,p_workspace_id:workspace.id});
  if(error){
   const message=error.message??"";
   if(message.includes("workspace_access_denied"))return NextResponse.json({error:"You do not have access to this workspace."},{status:403,headers});
   if(message.includes("active_entitlement_required"))return NextResponse.json({error:"Purchase this product before installing it."},{status:402,headers});
   if(message.includes("product_not_available")||message.includes("verified_version_required"))return NextResponse.json({error:"This product is not currently available for installation."},{status:404,headers});
   if(message.includes("authentication_required"))return NextResponse.json({error:"Authentication required."},{status:401,headers});
   throw error;
  }
  return NextResponse.json({installation:data,workspace:{id:workspace.id,name:workspace.name},message:"Added to your workspace. Configure and test it before activation; installation does not execute the workflow."},{status:200,headers});
 }catch(error){
  console.error("Marketplace install failed",error);
  return NextResponse.json({error:"Could not install this product. Try again."},{status:500,headers});
 }
}
