import { NextResponse,type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { verifyMarketplaceArtifact } from "@/lib/marketplace/verification";
const headers={"Cache-Control":"private, no-store"};
type Ctx={params:Promise<{reviewId:string}>};
function adminClient(){const url=process.env.NEXT_PUBLIC_SUPABASE_URL;const key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw new Error("Marketplace reviewer service is not configured.");return createSupabaseClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});}
async function reviewer(){const session=await createClient();const {data:{user},error}=await session.auth.getUser();if(error||!user)return {response:NextResponse.json({error:"Authentication required."},{status:401,headers})};const ids=(process.env.AIVANTA_MARKETPLACE_REVIEWER_IDS??"").split(",").map(x=>x.trim()).filter(Boolean);if(!ids.includes(user.id))return {response:NextResponse.json({error:"Marketplace reviewer access required."},{status:403,headers})};return {user,admin:adminClient()};}
export async function POST(request:NextRequest,ctx:Ctx){
 try{const auth=await reviewer();if("response"in auth)return auth.response;const {reviewId}=await ctx.params;if(!/^[0-9a-f-]{36}$/i.test(reviewId))return NextResponse.json({error:"Invalid review id."},{status:400,headers});
 const raw=await request.text();if(new TextEncoder().encode(raw).byteLength>4096)return NextResponse.json({error:"Request too large."},{status:413,headers});let body:Record<string,unknown>;try{body=JSON.parse(raw)}catch{return NextResponse.json({error:"Invalid JSON."},{status:400,headers});}
 const action=body.action;if(!["approve","reject","publish"].includes(String(action)))return NextResponse.json({error:"Choose approve, reject, or publish."},{status:400,headers});
 const {data:review,error}=await auth.admin.from("marketplace_verification_reviews").select("id,product_id,version_id,marketplace_product_versions(manifest)").eq("id",reviewId).maybeSingle();if(error||!review)return NextResponse.json({error:"Review not found."},{status:404,headers});
 if(action==="publish"){const {data,error:publishError}=await auth.admin.rpc("marketplace_publish_product",{p_product_id:review.product_id,p_version_id:review.version_id});if(publishError)return NextResponse.json({error:"Product must be verified before publishing."},{status:409,headers});return NextResponse.json({result:data},{headers});}
 const version=Array.isArray(review.marketplace_product_versions)?review.marketplace_product_versions[0]:review.marketplace_product_versions;
 const checks=action==="approve"?verifyMarketplaceArtifact(version?.manifest):{passed:false,checks:[{id:"human_review",label:"Human review",passed:false,detail:typeof body.notes==="string"?body.notes:"Rejected by Aivanta reviewer"}],artifactSha256:""};
 if(action==="approve"&&!checks.passed)return NextResponse.json({error:"Automated verification failed. Resolve all failed checks before approval.",checks:checks.checks},{status:422,headers});
 const {data,error:decisionError}=await auth.admin.rpc("marketplace_record_verification",{p_product_id:review.product_id,p_version_id:review.version_id,p_status:action==="approve"?"approved":"rejected",p_checks:checks.checks,p_notes:typeof body.notes==="string"?body.notes.slice(0,2000):""});
 if(decisionError)throw decisionError;
 return NextResponse.json({result:decisionError?null:data,checks:checks.checks},{headers});
 }catch(e){console.error("Marketplace review action failed",e);return NextResponse.json({error:"Could not complete marketplace review."},{status:500,headers});}
}
