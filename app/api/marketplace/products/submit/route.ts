import {NextResponse,type NextRequest} from "next/server";
import {createClient} from "@/lib/supabase/server";
import {verifyMarketplaceArtifact} from "@/lib/marketplace/verification";
const h={"Cache-Control":"private, no-store"};
export async function POST(req:NextRequest){
 try{
 const sb=await createClient();const {data:{user}}=await sb.auth.getUser();if(!user)return NextResponse.json({error:"Authentication required"},{status:401,headers:h});
 const raw=await req.text();if(new TextEncoder().encode(raw).byteLength>524288)return NextResponse.json({error:"Artifact exceeds 512 KB"},{status:413,headers:h});
 let b:any;try{b=JSON.parse(raw)}catch{return NextResponse.json({error:"Invalid JSON"},{status:400,headers:h})}
 const {data:creator,error:ce}=await sb.from("marketplace_creators").select("id,status").eq("user_id",user.id).maybeSingle();if(ce)throw ce;if(!creator||creator.status!=="verified")return NextResponse.json({error:"Aivanta creator verification is required."},{status:403,headers:h});
 const name=typeof b.name==="string"?b.name.trim():"",slug=typeof b.slug==="string"?b.slug.trim().toLowerCase():"",summary=typeof b.summary==="string"?b.summary.trim():"";
 if(name.length<3||name.length>140||summary.length<10||summary.length>280||!/^[a-z0-9-]{3,160}$/.test(slug)||!["workflow","pack","agent"].includes(b.product_type))return NextResponse.json({error:"Invalid product name, slug, summary or type."},{status:400,headers:h});
 const pricing=b.pricing_type??"free";if(!["free","one_time","recurring"].includes(pricing))return NextResponse.json({error:"Invalid pricing type"},{status:400,headers:h});
 const amount=pricing==="free"?0:Number(b.price_minor);if(!Number.isInteger(amount)||amount<0||(pricing!=="free"&&amount<1))return NextResponse.json({error:"Paid prices must be positive integer USD cents."},{status:400,headers:h});
 const checks=verifyMarketplaceArtifact(b.artifact);if(!checks.passed)return NextResponse.json({error:"Artifact failed automated checks",checks:checks.checks},{status:422,headers:h});
 const {data:p,error}=await sb.from("marketplace_products").insert({creator_id:creator.id,category_id:b.category_id,slug,name,summary,description:typeof b.description==="string"?b.description:"",product_type:b.product_type,pricing_type:pricing,price_minor:amount,currency:"USD",recurring_interval:pricing==="recurring"?b.recurring_interval:null,integrations:Array.isArray(b.integrations)?b.integrations:[],permissions:Array.isArray(b.permissions)?b.permissions:[],expected_usage:b.expected_usage&&typeof b.expected_usage==="object"?b.expected_usage:{},status:"draft",created_by:user.id}).select("id,slug,name,status").single();if(error)throw error;
 const path=`${user.id}/${p.id}/v1.json`;const up=await sb.storage.from("marketplace-artifacts").upload(path,new TextEncoder().encode(JSON.stringify(b.artifact)),{contentType:"application/json",upsert:false});if(up.error){await sb.from("marketplace_products").delete().eq("id",p.id);throw up.error}
 const {data:v,error:ve}=await sb.from("marketplace_product_versions").insert({product_id:p.id,version:"1.0.0",artifact_path:path,artifact_sha256:checks.artifactSha256,manifest:b.artifact,created_by:user.id}).select("id").single();if(ve)throw ve;
 const {error:se}=await sb.rpc("submit_marketplace_product",{p_product_id:p.id,p_version_id:v.id});if(se)throw se;
 return NextResponse.json({product:{...p,status:"submitted"},version:"1.0.0",checks:checks.checks,message:"Submitted for Aivanta review; not published or installable."},{status:201,headers:h});
 }catch(e){console.error("Marketplace submission failed",e);return NextResponse.json({error:"Submission failed. Verify creator status and applied marketplace migrations."},{status:500,headers:h})}
}