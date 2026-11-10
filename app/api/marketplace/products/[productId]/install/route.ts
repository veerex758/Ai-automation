import {NextResponse,type NextRequest} from "next/server";
import {createClient as createSupabaseClient} from "@supabase/supabase-js";
import {createClient} from "@/lib/supabase/server";
import {getOrCreateDefaultWorkspace} from "@/lib/supabase/workspace";
import {verifyMarketplaceStoredArtifact} from "@/lib/marketplace/verification";
const headers={"Cache-Control":"private, no-store"};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Context={params:Promise<{productId:string}>};
function adminClient(){
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)throw new Error("Marketplace installation service is not configured.");
 return createSupabaseClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
}
export async function POST(_request:NextRequest,context:Context){
 try{
  const supabase=await createClient();
  const {data:{user},error:authError}=await supabase.auth.getUser();
  if(authError||!user)return NextResponse.json({error:"Authentication required."},{status:401,headers});
  const {productId}=await context.params;
  if(!uuid.test(productId))return NextResponse.json({error:"Invalid product ID."},{status:400,headers});

  const admin=adminClient();
  const {data:product,error:productError}=await admin.from("marketplace_products")
   .select("id,name,current_version_id,status").eq("id",productId).maybeSingle();
  if(productError)throw productError;
  if(!product||product.status!=="published"||!product.current_version_id)return NextResponse.json({error:"This product is not currently available for installation."},{status:404,headers});

  const {data:version,error:versionError}=await admin.from("marketplace_product_versions")
   .select("id,artifact_path,artifact_sha256,verification_status,manifest,created_by")
   .eq("id",product.current_version_id).eq("product_id",productId).maybeSingle();
  if(versionError)throw versionError;
  if(!version||version.verification_status!=="approved")return NextResponse.json({error:"This product version is not verified for installation."},{status:409,headers});
  const artifactPathParts=typeof version.artifact_path==="string"?version.artifact_path.split("/"):[];
  if(artifactPathParts.length!==3||artifactPathParts[0]!==version.created_by||artifactPathParts[1]!==productId||artifactPathParts.some((part:string)=>!part||part==="."||part===".."||part.includes("\\"))){
   return NextResponse.json({error:"The verified artifact storage path is invalid."},{status:409,headers});
  }
  const {data:artifactFile,error:artifactError}=await admin.storage.from("marketplace-artifacts").download(version.artifact_path);
  if(artifactError||!artifactFile)return NextResponse.json({error:"The verified product artifact is unavailable. Installation is blocked."},{status:409,headers});
  if(artifactFile.size>524288)return NextResponse.json({error:"The product artifact exceeds the 512 KiB installation limit."},{status:413,headers});
  const storedArtifact=verifyMarketplaceStoredArtifact(await artifactFile.text(),version.manifest,version.artifact_sha256);
  if(!storedArtifact.integrityPassed||!storedArtifact.verification.passed){
   return NextResponse.json({error:"The product artifact failed integrity or automated verification. Installation is blocked."},{status:409,headers});
  }

  const workspace=await getOrCreateDefaultWorkspace(supabase);
  const {data:installation,error:installError}=await supabase.rpc("marketplace_install_product",{p_product_id:productId,p_workspace_id:workspace.id});
  if(installError){
   const message=installError.message??"";
   if(message.includes("workspace_access_denied"))return NextResponse.json({error:"You do not have access to this workspace."},{status:403,headers});
   if(message.includes("active_entitlement_required"))return NextResponse.json({error:"Purchase this product before installing it."},{status:402,headers});
   if(message.includes("product_not_available")||message.includes("verified_version_required"))return NextResponse.json({error:"This product is not currently available for installation."},{status:404,headers});
   if(message.includes("authentication_required"))return NextResponse.json({error:"Authentication required."},{status:401,headers});
   throw installError;
  }
  const installationRecord=installation&&typeof installation==="object"?installation as Record<string,unknown>:{};
  const installationId=installationRecord.installation_id;
  if(typeof installationId!=="string")throw new Error("Marketplace install transition returned no installation ID.");
  if(installationRecord.product_version_id!==version.id){
   return NextResponse.json({
    error:"This product has a newer verified version. Your installed version was left unchanged.",
    updateAvailable:true,
    installation:installationRecord
   },{status:409,headers});
  }
  const {data:materialized,error:materializeError}=await admin.rpc("marketplace_materialize_installation",{
   p_installation_id:installationId,p_actor_id:user.id,p_artifact_sha256:version.artifact_sha256
  });
  if(materializeError){
   if(materializeError.message.includes("product_version_no_longer_installable")||materializeError.message.includes("artifact_hash_mismatch")||materializeError.message.includes("creator_not_verified")){
    return NextResponse.json({error:"The product changed during installation. Refresh the listing and try again."},{status:409,headers});
   }
   throw materializeError;
  }
  return NextResponse.json({
   installation:{...installationRecord,workflow_id:materialized?.workflow_id},
   workflow:{id:materialized?.workflow_id,status:"draft"},
   workspace:{id:workspace.id,name:workspace.name},
   message:"Copied into your workspace as a draft. Configure your own connections and test it before activation; installation never executes the workflow."
  },{status:200,headers});
 }catch(error){
  console.error("Marketplace install failed",error);
  return NextResponse.json({error:"Could not install this product. Try again."},{status:500,headers});
 }
}
