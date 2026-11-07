import {NextResponse,type NextRequest} from "next/server";
import {createClient} from "@/lib/supabase/server";
import {verifyMarketplaceArtifact} from "@/lib/marketplace/verification";
const headers={"Cache-Control":"private, no-store"};type Ctx={params:Promise<{productId:string}>};
export async function POST(request:NextRequest,ctx:Ctx){
 try{const supabase=await createClient();const {data:{user},error:authError}=await supabase.auth.getUser();if(authError||!user)return NextResponse.json({error:"Authentication required."},{status:401,headers});
 const {productId}=await ctx.params;const raw=await request.text();if(new TextEncoder().encode(raw).byteLength>100000)return NextResponse.json({error:"Version manifest exceeds 100 KiB."},{status:413,headers});let b:Record<string,unknown>;try{b=JSON.parse(raw)}catch{return NextResponse.json({error:"Invalid JSON."},{status:400,headers});}
 const version=typeof b.version==="string"?b.version.trim():"";if(!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9.]+)?$/.test(version))return NextResponse.json({error:"Use semantic versioning (e.g. 1.0.0). "},{status:400,headers});
 const manifest=b.manifest;if(!manifest||typeof manifest!=="object"||Array.isArray(manifest))return NextResponse.json({error:"Manifest must be a JSON object."},{status:400,headers});
 const check=verifyMarketplaceArtifact(manifest);if(!check.checks.find(x=>x.id==="workflow_schema")?.passed)return NextResponse.json({error:"Workflow validation failed.",checks:check.checks},{status:422,headers});
 const {data:product,error:productError}=await supabase.from("marketplace_products").select("id,status,created_by").eq("id",productId).eq("created_by",user.id).maybeSingle();if(productError||!product||!["draft","changes_requested"].includes(product.status))return NextResponse.json({error:"Product not found or not editable."},{status:404,headers});
 const {data,error}=await supabase.from("marketplace_product_versions").insert({product_id:productId,version,artifact_path:`manifest:${check.artifactSha256}`,artifact_sha256:check.artifactSha256,manifest,created_by:user.id,verification_status:"pending",changelog:typeof b.changelog==="string"?b.changelog.slice(0,4000):""}).select("id,version,verification_status,artifact_sha256").single();
 if(error){if(error.code==="23505")return NextResponse.json({error:"That product version already exists."},{status:409,headers});throw error;}
 const {error:linkError}=await supabase.from("marketplace_products").update({current_version_id:data.id}).eq("id",productId).eq("created_by",user.id);if(linkError)throw linkError;
 return NextResponse.json({version:data,preflight:check.checks,message:"Draft version saved. Submit it for Aivanta verification."},{status:201,headers});
 }catch(e){console.error("Marketplace version create failed",e);return NextResponse.json({error:"Could not save product version."},{status:500,headers});}
}
