import {NextResponse,type NextRequest} from "next/server";
import {createClient as createSupabaseClient} from "@supabase/supabase-js";
import {createClient} from "@/lib/supabase/server";
import {verifyMarketplaceArtifact} from "@/lib/marketplace/verification";
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
  const action=body.action;if(!["approve","reject","publish"].includes(String(action)))return NextResponse.json({error:"Choose approve, reject, or publish."},{status:400,headers});
  const {data:review,error}=await auth.admin.from("marketplace_verification_reviews").select("id,product_id,version_id,marketplace_product_versions!inner(id,version,artifact_sha256,verification_status,manifest)").eq("id",reviewId).maybeSingle();
  if(error||!review)return NextResponse.json({error:"Review not found."},{status:404,headers});
  const version=Array.isArray(review.marketplace_product_versions)?review.marketplace_product_versions[0]:review.marketplace_product_versions;
  if(!version)return NextResponse.json({error:"Submitted version is unavailable."},{status:409,headers});
  if(action==="publish"){
   const {data,error:publishError}=await auth.admin.rpc("marketplace_publish_product",{p_product_id:review.product_id,p_version_id:review.version_id});
   if(publishError)return NextResponse.json({error:"Product must be verified before publishing."},{status:409,headers});
   await auth.admin.from("marketplace_admin_audit").insert({actor_id:auth.user.id,action:"product_published",entity_type:"product",entity_id:review.product_id,details:{version_id:review.version_id,artifact_sha256:version.artifact_sha256}});
   return NextResponse.json({result:data},{headers});
  }
  if(version.verification_status!=="pending")return NextResponse.json({error:"This version has already received a verification decision. Submit a new version for reverification."},{status:409,headers});
  const verification=verifyMarketplaceArtifact(version.manifest);
  if(verification.artifactSha256!==version.artifact_sha256)return NextResponse.json({error:"Stored artifact hash does not match the submitted version. Approval is blocked."},{status:409,headers});
  if(action==="approve"&&!verification.passed)return NextResponse.json({error:"Automated verification failed. Resolve all failed checks before approval.",checks:verification.checks},{status:422,headers});
  const notes=typeof body.notes==="string"?body.notes.slice(0,2000):"";
  const integrityCheck={id:"artifact_integrity",label:"Stored version matches canonical SHA-256",passed:true,detail:` + "`SHA-256 ${verification.artifactSha256}`" + `};
  const checks=action==="approve"?[...verification.checks,integrityCheck]:[...verification.checks,integrityCheck,{id:"human_review",label:"Human reviewer decision",passed:false,detail:notes||"Rejected by Aivanta reviewer"}];
  const {data,error:decisionError}=await auth.admin.rpc("marketplace_record_verification",{
   p_product_id:review.product_id,p_version_id:review.version_id,p_status:action==="approve"?"approved":"rejected",
   p_checks:checks,p_notes:notes,p_reviewer_id:auth.user.id,p_artifact_sha256:verification.artifactSha256
  });
  if(decisionError)throw decisionError;
  return NextResponse.json({result:data,checks,artifactSha256:verification.artifactSha256,reviewerId:auth.user.id},{headers});
 }catch(e){console.error("Marketplace review action failed",e);return NextResponse.json({error:"Could not complete marketplace review."},{status:500,headers});}
}
