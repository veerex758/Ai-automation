import {NextResponse,type NextRequest} from "next/server";
import {createClient} from "@/lib/supabase/server";
import {verifyMarketplaceArtifact} from "@/lib/marketplace/verification";
const headers={"Cache-Control":"private, no-store"};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Ctx={params:Promise<{productId:string}>};
export async function POST(request:NextRequest,ctx:Ctx){
 try{
  const supabase=await createClient();
  const {data:{user},error:authError}=await supabase.auth.getUser();
  if(authError||!user)return NextResponse.json({error:"Authentication required."},{status:401,headers});
  const {productId}=await ctx.params;
  if(!uuid.test(productId))return NextResponse.json({error:"Invalid product ID."},{status:400,headers});
  const raw=await request.text();
  if(new TextEncoder().encode(raw).byteLength>524288)return NextResponse.json({error:"Version manifest exceeds 512 KiB."},{status:413,headers});
  let body:Record<string,unknown>;
  try{const parsed:unknown=JSON.parse(raw);if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))return NextResponse.json({error:"Invalid request body."},{status:400,headers});body=parsed as Record<string,unknown>;}
  catch{return NextResponse.json({error:"Invalid JSON."},{status:400,headers});}
  const version=typeof body.version==="string"?body.version.trim():"";
  if(!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9.]+)?$/.test(version))return NextResponse.json({error:"Use semantic versioning (e.g. 1.0.0)."},{status:400,headers});
  const manifest=body.manifest;
  if(!manifest||typeof manifest!=="object"||Array.isArray(manifest))return NextResponse.json({error:"Manifest must be a JSON object."},{status:400,headers});
  const verification=verifyMarketplaceArtifact(manifest);
  if(!verification.passed)return NextResponse.json({error:"Artifact failed automated preflight checks.",checks:verification.checks},{status:422,headers});
  const {data:product,error:productError}=await supabase.from("marketplace_products").select("id,status,created_by").eq("id",productId).eq("created_by",user.id).maybeSingle();
  if(productError)throw productError;
  if(!product||!["draft","changes_requested"].includes(product.status))return NextResponse.json({error:"Product not found or not editable."},{status:404,headers});
  const artifactPath=`${user.id}/${productId}/${version}.json`;
  const upload=await supabase.storage.from("marketplace-artifacts").upload(artifactPath,new TextEncoder().encode(JSON.stringify(manifest)),{contentType:"application/json",upsert:false});
  if(upload.error){if(upload.error.message.toLowerCase().includes("already exists"))return NextResponse.json({error:"That artifact version already exists."},{status:409,headers});throw upload.error;}
  const {data:saved,error:saveError}=await supabase.from("marketplace_product_versions").insert({
   product_id:productId,version,artifact_path:artifactPath,artifact_sha256:verification.artifactSha256,
   manifest,created_by:user.id,verification_status:"pending",changelog:typeof body.changelog==="string"?body.changelog.slice(0,4000):""
  }).select("id,version,verification_status,artifact_sha256").single();
  if(saveError){await supabase.storage.from("marketplace-artifacts").remove([artifactPath]);if(saveError.code==="23505")return NextResponse.json({error:"That product version already exists."},{status:409,headers});throw saveError;}
  const {error:linkError}=await supabase.from("marketplace_products").update({current_version_id:saved.id}).eq("id",productId).eq("created_by",user.id);
  if(linkError)throw linkError;
  return NextResponse.json({version:saved,preflight:verification.checks,message:"Verified draft artifact saved privately. Submit this version for Aivanta review."},{status:201,headers});
 }catch(error){console.error("Marketplace version create failed",error);return NextResponse.json({error:"Could not save product version."},{status:500,headers});}
}
