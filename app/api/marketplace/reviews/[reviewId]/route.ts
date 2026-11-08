import {NextResponse,type NextRequest} from "next/server";
import {createClient as createSupabaseClient} from "@supabase/supabase-js";
import {createClient} from "@/lib/supabase/server";
import {verifyMarketplaceStoredArtifact} from "@/lib/marketplace/verification";
const headers={"Cache-Control":"private, no-store"};
type Ctx={params:Promise<{reviewId:string}>};
function adminClient(){const url=process.env.NEXT_PUBLIC_SUPABASE_URL;const key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw new Error("Marketplace reviewer service is not configured.");return createSupabaseClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});}
async function reviewer(){const session=await createClient();const {data:{user},error}=await session.auth.getUser();if(error||!user)return {response:NextResponse.json({error:"Authentication required."},{status:401,headers})};const ids=(process.env.AIVANTA_MARKETPLACE_REVIEWER_IDS??"").split(",").map(x=>x.trim()).filter(Boolean);if(!ids.includes(user.id))return {response:NextResponse.json({error:"Marketplace reviewer access required."},{status:403,headers})};return {user,admin:adminClient()};}
export async function POST(request:NextRequest,ctx:Ctx){
 try{
  const auth=await reviewer();if("response"in auth)return auth.response;
  const {reviewId}=await ctx.params;if(!/^[0-9a-f-]{36}$/i.test(reviewId))return NextResponse.json({error:"Invalid review id."},{status:400,headers});
  const raw=await request.text();if(new TextEncoder().encode(raw).byteLength>4096)return NextResponse.json({error:"Request too large."},{status:413,headers});
  let body:Record<string,unknown>;try{body=JSON.parse(raw)}catch{return NextResponse.json({error:"Invalid JSON."},{status:400,headers});}
  const action=body.action;if(!["approve","reject","request_changes","publish"].includes(String(action)))return NextResponse.json({error:"Choose approve, reject, request_changes, or publish."},{status:400,headers});
  const {data:review,error}=await auth.admin.from("marketplace_verification_reviews").select("id,product_id,version_id,marketplace_product_versions!inner(id,version,artifact_path,artifact_sha256,verification_status,manifest,created_by)").eq("id",reviewId).maybeSingle();
  if(error||!review)return NextResponse.json({error:"Review not found."},{status:404,headers});
  const version=Array.isArray(review.marketplace_product_versions)?review.marketplace_product_versions[0]:review.marketplace_product_versions;
  if(!version)return NextResponse.json({error:"Submitted version is unavailable."},{status:409,headers});
  const artifactPathParts=typeof version.artifact_path==="string"?version.artifact_path.split("/"):[];
  if(artifactPathParts.length!==3||artifactPathParts[0]!==version.created_by||artifactPathParts[1]!==review.product_id||artifactPathParts.some((part:string)=>!part||part==="."||part===".."||part.includes("\\")))return NextResponse.json({error:"Submitted artifact path is unavailable."},{status:409,headers});
  const {data:artifactFile,error:artifactError}=await auth.admin.storage.from("marketplace-artifacts").download(version.artifact_path);
  if(artifactError||!artifactFile)return NextResponse.json({error:"The private submitted artifact could not be retrieved. Review is blocked until the artifact is restored."},{status:409,headers});
  if(artifactFile.size>524288)return NextResponse.json({error:"The submitted artifact exceeds the 512 KiB verification limit."},{status:413,headers});
  const storedArtifact=verifyMarketplaceStoredArtifact(await artifactFile.text(),version.manifest,version.artifact_sha256);
  const verification=storedArtifact.verification;
  if(action==="publish"){
   if(version.verification_status!=="approved"||!storedArtifact.integrityPassed||!verification.passed)return NextResponse.json({error:"The approved artifact is missing, changed, or no longer passes verification. Publication is blocked."},{status:409,headers});
   const {data,error:publishError}=await auth.admin.rpc("marketplace_publish_product",{p_product_id:review.product_id,p_version_id:review.version_id});
   if(publishError)return NextResponse.json({error:"Product must be verified before publishing."},{status:409,headers});
   await auth.admin.from("marketplace_admin_audit").insert({actor_id:auth.user.id,action:"product_published",entity_type:"product",entity_id:review.product_id,details:{version_id:review.version_id,artifact_sha256:version.artifact_sha256}});
   return NextResponse.json({result:data},{headers});
  }
  if(version.verification_status!=="pending")return NextResponse.json({error:"This version has already received a verification decision. Submit a new version for reverification."},{status:409,headers});
  if(action==="approve"&&(!storedArtifact.integrityPassed||!verification.passed))return NextResponse.json({error:"The stored artifact failed integrity or automated verification. Resolve all failed checks before approval.",checks:verification.checks,artifactIntegrity:storedArtifact.detail},{status:422,headers});
  const notes=typeof body.notes==="string"?body.notes.slice(0,2000):"";
  const integrityCheck={id:"artifact_integrity",label:"Uploaded artifact bytes match the immutable version hash",passed:storedArtifact.integrityPassed,detail:storedArtifact.detail};
  const checks=action==="approve"?[...verification.checks,integrityCheck]:[...verification.checks,integrityCheck,{id:"human_review",label:"Human reviewer decision",passed:false,detail:notes||"Rejected by Aivanta reviewer"}];
  const {data,error:decisionError}=await auth.admin.rpc("marketplace_record_verification",{
   p_product_id:review.product_id,p_version_id:review.version_id,p_status:action==="approve"?"approved":action==="request_changes"?"changes_requested":"rejected",
   p_checks:checks,p_notes:notes,p_reviewer_id:auth.user.id,p_artifact_sha256:version.artifact_sha256
  });
  if(decisionError)throw decisionError;
  return NextResponse.json({result:data,checks,artifactSha256:verification.artifactSha256,reviewerId:auth.user.id},{headers});
 }catch(e){console.error("Marketplace review action failed",e);return NextResponse.json({error:"Could not complete marketplace review."},{status:500,headers});}
}
