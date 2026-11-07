import {NextResponse,type NextRequest} from "next/server";
import {createClient} from "@/lib/supabase/server";
import {verifyMarketplaceArtifact} from "@/lib/marketplace/verification";
const h={"Cache-Control":"private, no-store"};
const productTypes=["workflow","pack","agent"] as const;
const pricingTypes=["free","one_time","recurring"] as const;
export async function POST(req:NextRequest){
 try{
 const sb=await createClient();const {data:{user}}=await sb.auth.getUser();if(!user)return NextResponse.json({error:"Authentication required"},{status:401,headers:h});
 const raw=await req.text();if(new TextEncoder().encode(raw).byteLength>524288)return NextResponse.json({error:"Artifact exceeds 512 KB"},{status:413,headers:h});
 let parsed:unknown;try{parsed=JSON.parse(raw)}catch{return NextResponse.json({error:"Invalid JSON"},{status:400,headers:h})}
 if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))return NextResponse.json({error:"Invalid request body"},{status:400,headers:h});
 const body=parsed as Record<string,unknown>;
 const {data:creator,error:ce}=await sb.from("marketplace_creators").select("id,status").eq("user_id",user.id).maybeSingle();if(ce)throw ce;if(!creator||creator.status!=="verified")return NextResponse.json({error:"Aivanta creator verification is required."},{status:403,headers:h});
 const categoryId=typeof body.category_id==="string"?body.category_id:"";if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(categoryId))return NextResponse.json({error:"Choose a valid Marketplace category."},{status:400,headers:h});
 const name=typeof body.name==="string"?body.name.trim():"",slug=typeof body.slug==="string"?body.slug.trim().toLowerCase():"",summary=typeof body.summary==="string"?body.summary.trim():"";
 const productType=typeof body.product_type==="string"&&productTypes.includes(body.product_type as typeof productTypes[number])?body.product_type:null;
 if(name.length<3||name.length>140||summary.length<10||summary.length>280||!/^[a-z0-9-]{3,160}$/.test(slug)||!productType)return NextResponse.json({error:"Invalid product name, slug, summary or type."},{status:400,headers:h});
 const pricing=typeof body.pricing_type==="string"?body.pricing_type:"free";if(!pricingTypes.includes(pricing as typeof pricingTypes[number]))return NextResponse.json({error:"Invalid pricing type"},{status:400,headers:h});
 const amount=pricing==="free"?0:Number(body.price_minor);if(!Number.isSafeInteger(amount)||amount<0||(pricing!=="free"&&amount<1))return NextResponse.json({error:"Paid prices must be positive integer USD cents."},{status:400,headers:h});
 const interval=body.recurring_interval==="month"||body.recurring_interval==="year"?body.recurring_interval:null;
 if(pricing==="recurring"&&!interval)return NextResponse.json({error:"Recurring products must specify a monthly or yearly interval."},{status:400,headers:h});
 const integrations=Array.isArray(body.integrations)?body.integrations.filter((x):x is string=>typeof x==="string").slice(0,100):[];
 const permissions=Array.isArray(body.permissions)?body.permissions.slice(0,100):[];
 const artifact=body.artifact&&typeof body.artifact==="object"&&!Array.isArray(body.artifact)?{...(body.artifact as Record<string,unknown>),permissions}:body.artifact;
 const checks=verifyMarketplaceArtifact(artifact);if(!checks.passed)return NextResponse.json({error:"Artifact failed automated checks",checks:checks.checks},{status:422,headers:h});
 const expectedUsage=body.expected_usage&&typeof body.expected_usage==="object"&&!Array.isArray(body.expected_usage)?body.expected_usage:{};
 const {data:p,error}=await sb.from("marketplace_products").insert({creator_id:creator.id,category_id:categoryId,slug,name,summary,description:typeof body.description==="string"?body.description.slice(0,5000):"",product_type:productType,pricing_type:pricing,price_minor:amount,currency:"USD",recurring_interval:pricing==="recurring"?interval:null,integrations,permissions,expected_usage:expectedUsage,status:"draft",created_by:user.id}).select("id,slug,name,status").single();if(error)throw error;
 const path=`${user.id}/${p.id}/v1.json`;const up=await sb.storage.from("marketplace-artifacts").upload(path,new TextEncoder().encode(JSON.stringify(artifact)),{contentType:"application/json",upsert:false});if(up.error){await sb.from("marketplace_products").delete().eq("id",p.id);throw up.error}
 const {data:v,error:ve}=await sb.from("marketplace_product_versions").insert({product_id:p.id,version:"1.0.0",artifact_path:path,artifact_sha256:checks.artifactSha256,manifest:artifact,created_by:user.id}).select("id").single();if(ve)throw ve;
 const {error:se}=await sb.rpc("submit_marketplace_product",{p_product_id:p.id,p_version_id:v.id});if(se)throw se;
 return NextResponse.json({product:{...p,status:"submitted"},version:"1.0.0",checks:checks.checks,message:"Submitted for Aivanta review; not published or installable."},{status:201,headers:h});
 }catch(e){console.error("Marketplace submission failed",e);return NextResponse.json({error:"Submission failed. Verify creator status and applied marketplace migrations."},{status:500,headers:h})}
}