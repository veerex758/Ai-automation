import {NextResponse,type NextRequest} from "next/server";
import {createClient} from "@/lib/supabase/server";
import {verifyMarketplaceArtifact} from "@/lib/marketplace/verification";
const h={"Cache-Control":"private, no-store"};
export async function POST(req:NextRequest){
 try{const sb=await createClient();const {data:{user}}=await sb.auth.getUser();if(!user)return NextResponse.json({error:"Authentication required"},{status:401,headers:h});
 const raw=await req.text();if(new TextEncoder().encode(raw).byteLength>512*1024)return NextResponse.json({error:"Artifact exceeds 512 KB"},{status:413,headers:h});
 let b:any;try{b=JSON.parse(raw)}catch{return NextResponse.json({error:"Invalid JSON"},{status:400,headers:h})}
 const {data:creator,error:ce}=await sb.from("marketplace_creators").select("id,status").eq("user_id",user.id).maybeSingle();if(ce)throw ce;if(!creator||creator.status!=="verified")return NextResponse.json({error:"Aivanta creator verification is required before submitting products."},{status:403,headers:h});
 const name=typeof b.name==="string"?b.name.trim():"",slug=typeof b.slug==="string"?b.slug.trim().toLowerCase():"",summary=typeof b.summary==="string"?b.summary.trim():"",category=b.category_id;
 if(name.length<3||name.length>140||summary.length<10||summary.length>280||!/^[a-z0-9-]{3,160}$/.test(slug))return NextResponse.json({error:"Check product name, slug, and summary fields."},{status:400,headers:h});
 const pricing=b.pricing_type??"free";if(!["free","one_time","recurring"].includes(pricing))return NextResponse.json({error:"Invalid pricing type"},{status:400,headers:h});
 const amount=pricing==="free"?0:Number(b.price_minor);if(!Number.isInteger(amount)||amount<0||(pricing!=="free"&&amount<1))return NextResponse.json({error:"Price must be a positive integer in USD cents for paid products."},{status:400,headers:h});
 const checks=verifyMarketplaceArtifact(b.artifact);if(!checks.passed)return NextResponse.json({error:"Artifact failed automated verification",checks:checks.checks},{status:422,headers:h});
 const {data:p,error}=await sb.from("marketplace_products").insert({creator_id:creator.id,category_id:category,slug,name,summary,description:typeof b.description==="string"?b.description:"",product_type:b.product_type,pricing_type:pricing,price_minor:amount,currency:"USD",recurring_interval:pricing==="recurring"?b.recurring_interval:null,integrations:Array.isArray(b.integrations)?b.integrations:[],permissions:Array.isArray(b.permissions)?b.permissions:[],expected_usage:b.expected_usage&&typeof b.expected_usage==="object"?b.expected_usage:{},status:"draft",created_by:user.id}).select("id,slug,name,status").single();
 if(error)throw error;
 // Artifact storage is private and versioned; upload implementation must be configured before accepting bytes.
 return NextResponse.json({product:p,verification:checks,message:"Draft created. Secure artifact storage/version submission is the next workflow step; no product is published."},{status:201,headers:h});
 }catch(e){console.error("Marketplace product draft failed",e);return NextResponse.json({error:"Could not create marketplace product draft."},{status:500,headers:h})}
}
