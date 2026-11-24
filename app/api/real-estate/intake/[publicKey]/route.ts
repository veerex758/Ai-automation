import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createRealEstateServiceClient, createFollowupRows } from "@/lib/real-estate/server";
import { scoreRealEstateLead, type RealEstateLeadInput } from "@/lib/real-estate/lead-scoring";
import { processRealEstateLeadPipeline } from "@/lib/real-estate/pipeline";
import { enforceDistributedRateLimit } from "@/lib/security/distributed-rate-limit";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=60;
type Context={params:Promise<{publicKey:string}>};
type Form={id:string;workspace_id:string;default_source:string;allowed_origins:string[];enabled:boolean};
type IntakeLead = { id: string; workspace_id: string; source: string; full_name: string; email: string | null; preferred_location: string | null; property_type: string; transaction_type: string; lead_score: number; created_at: string; consent_to_contact: boolean; contact_preference: string };
const isRecord=(v:unknown):v is Record<string,unknown>=>Boolean(v&&typeof v==="object"&&!Array.isArray(v));
function originHeaders(origin:string|null,form:Form){
 const h:Record<string,string>={"Cache-Control":"no-store","Vary":"Origin"};
 if(origin&&form.allowed_origins.includes(origin)){h["Access-Control-Allow-Origin"]=origin;h["Access-Control-Allow-Methods"]="POST, OPTIONS";h["Access-Control-Allow-Headers"]="Content-Type, Idempotency-Key";h["Access-Control-Max-Age"]="600";}
 return h;
}
async function findForm(key:string):Promise<{db:ReturnType<typeof createRealEstateServiceClient>;form:Form|null}>{
 const db=createRealEstateServiceClient(),hash=createHash("sha256").update(key,"utf8").digest("hex");
 const {data,error}=await db.from("real_estate_intake_forms").select("id,workspace_id,default_source,allowed_origins,enabled").eq("public_key_hash",hash).maybeSingle();
 if(error)throw new Error("INTAKE_FORM_LOOKUP_FAILED");
 return {db,form:data as Form|null};
}

async function ensurePublicLeadSideEffects(
 db:ReturnType<typeof createRealEstateServiceClient>,
 lead:IntakeLead,
 workspaceId:string,
 formId:string,
){
 const {data:activity,error:activityLookupError}=await db.from("real_estate_lead_activities")
  .select("id").eq("workspace_id",workspaceId).eq("lead_id",lead.id).eq("activity_type","lead.received").limit(1).maybeSingle();
 if(activityLookupError)throw activityLookupError;
 if(!activity){
  const {error}=await db.from("real_estate_lead_activities").insert({
   workspace_id:workspaceId,lead_id:lead.id,actor_user_id:null,activity_type:"lead.received",
   details:{source:lead.source,formId,score:lead.lead_score},
  });
  if(error)throw error;
 }
 if(!lead.consent_to_contact||lead.contact_preference!=="email"||!lead.email)return 0;
 const rows=createFollowupRows(lead as Parameters<typeof createFollowupRows>[0],new Date(lead.created_at));
 const {error:queueError}=await db.from("real_estate_followups")
  .upsert(rows,{onConflict:"lead_id,sequence",ignoreDuplicates:true});
 if(queueError)throw queueError;
 return rows.length;
}

export async function OPTIONS(request:NextRequest,context:Context){
 try{const {publicKey}=await context.params;if(!/^[A-Za-z0-9_-]{32,100}$/.test(publicKey))return new NextResponse(null,{status:404});
 const {form}=await findForm(publicKey);if(!form||!form.enabled)return new NextResponse(null,{status:404});
 const origin=request.headers.get("origin");if(!origin||!form.allowed_origins.includes(origin))return new NextResponse(null,{status:403,headers:{"Vary":"Origin"}});
 return new NextResponse(null,{status:204,headers:originHeaders(origin,form)});
 }catch{return new NextResponse(null,{status:503});}
}
export async function POST(request:NextRequest,context:Context){
 try{
  const {publicKey}=await context.params;if(!/^[A-Za-z0-9_-]{32,100}$/.test(publicKey))return NextResponse.json({error:"Intake form not found."},{status:404});
  const {db,form}=await findForm(publicKey);if(!form||!form.enabled)return NextResponse.json({error:"Intake form is disabled or unavailable."},{status:404});
  const origin=request.headers.get("origin"),headers=originHeaders(origin,form);
  if(!origin||!form.allowed_origins.includes(origin))return NextResponse.json({error:"This website origin is not allowed to submit to this form."},{status:403,headers});
  const ipLimit=await enforceDistributedRateLimit(request,{
   scope:"real-estate-public-intake",windowMs:60_000,ipLimit:10,
  });
  if(ipLimit)return ipLimit;
  const tenantLimit=await enforceDistributedRateLimit(request,{
   scope:"real-estate-public-intake-hourly",windowMs:60*60_000,
   workspaceId:form.workspace_id,workspaceLimit:100,
   resourceId:form.id,resourceLimit:20,
  });
  if(tenantLimit)return tenantLimit;
  const raw=await request.text();if(Buffer.byteLength(raw,"utf8")>16000)return NextResponse.json({error:"Enquiry exceeds 16 KiB."},{status:413,headers});
  let body:unknown;try{body=JSON.parse(raw)}catch{return NextResponse.json({error:"Enquiry must be valid JSON."},{status:400,headers});}
  if(!isRecord(body))return NextResponse.json({error:"Enquiry must be a JSON object."},{status:400,headers});
  const fullName=typeof body.fullName==="string"?body.fullName.trim().slice(0,160):"";
  const email=typeof body.email==="string"?body.email.trim().toLowerCase().slice(0,254):null;
  const phone=typeof body.phone==="string"?body.phone.trim().slice(0,40):null;
  const idempotencyKey=(request.headers.get("idempotency-key")??(typeof body.sourceEventId==="string"?body.sourceEventId:"")).trim();
  if(!/^[A-Za-z0-9._:-]{8,200}$/.test(idempotencyKey))return NextResponse.json({error:"Provide a unique Idempotency-Key header (8–200 safe characters)."} ,{status:400,headers});
  if(!fullName||(!email&&!phone)||typeof body.consentToContact!=="boolean")return NextResponse.json({error:"Name, email or phone, and an explicit contact-consent choice are required."},{status:400,headers});
  if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return NextResponse.json({error:"Enter a valid email address."},{status:400,headers});
  const ip=request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()??"unknown";
  const ipHash=createHash("sha256").update(publicKey+":"+ip).digest("hex").slice(0,32);
  const {data:limit,error:limitError}=await db.rpc("consume_execution_rate_limit",{p_workspace_id:form.workspace_id,p_key:"real-estate-intake:"+form.id+":"+ipHash,p_limit:20,p_window_ms:3600000});
  const rate=Array.isArray(limit)?limit[0]:limit;
  if(limitError||!rate||rate.allowed!==true)return NextResponse.json({error:"Too many enquiries from this network. Please try again later."},{status:429,headers});
  const source=form.default_source,sourceEventId=idempotencyKey;
  const {data:prior,error:priorError}=await db.from("real_estate_leads").select("*")
    .eq("workspace_id",form.workspace_id).eq("source",source).eq("source_event_id",sourceEventId).maybeSingle();
  if(priorError)throw priorError;
  if(prior){
   await ensurePublicLeadSideEffects(db,prior,form.workspace_id,form.id);
   let pipeline={enabled:false,claimed:0,completed:0,blocked:0,failed:0};
   try{pipeline=await processRealEstateLeadPipeline({db,workspaceId:form.workspace_id,leadId:prior.id});}
   catch(error){console.error("Duplicate enquiry pipeline recovery failed",error);}
   return NextResponse.json({accepted:true,duplicate:true},{status:200,headers});
  }
  const budgetMin=body.budgetMin===undefined||body.budgetMin===null||body.budgetMin===""?null:Number(body.budgetMin);
  const budgetMax=body.budgetMax===undefined||body.budgetMax===null||body.budgetMax===""?null:Number(body.budgetMax);
  const currency=typeof body.currency==="string"?body.currency.toUpperCase():"USD";
  const bedrooms=body.bedrooms===undefined||body.bedrooms===null||body.bedrooms===""?null:Number(body.bedrooms);
  if((budgetMin!==null&&(!Number.isFinite(budgetMin)||budgetMin<0||budgetMin>1e12))||(budgetMax!==null&&(!Number.isFinite(budgetMax)||budgetMax<0||budgetMax>1e12))||(budgetMin!==null&&budgetMax!==null&&budgetMax<budgetMin)||!/^[A-Z]{3}$/.test(currency)||
    (bedrooms!==null&&(!Number.isInteger(bedrooms)||bedrooms<0||bedrooms>50)))return NextResponse.json({error:"Invalid budget, currency or bedroom count."},{status:400,headers});
  const enumValue=<T extends string>(value:unknown,values:readonly T[],fallback:T):T=>typeof value==="string"&&values.includes(value as T)?value as T:fallback;
  const transactionType=enumValue(body.transactionType,["buy","rent","invest","sell","unknown"] as const,"unknown");
  const propertyType=enumValue(body.propertyType,["apartment","house","land","commercial","other","unknown"] as const,"unknown");
  const timeframe=enumValue(body.timeframe,["urgent","within_30_days","one_to_three_months","over_three_months","unknown"] as const,"unknown");
  const readiness=enumValue(body.readiness,["cash_ready","pre_approved","financing_needed","researching","unknown"] as const,"unknown");
  const contactPreference=enumValue(body.contactPreference,["email","phone","whatsapp"],"email");
  const preferredLocation=typeof body.preferredLocation==="string"?body.preferredLocation.trim().slice(0,200):null;
  const leadInput: RealEstateLeadInput = {transactionType,propertyType,preferredLocation,budgetMin,budgetMax,timeframe,readiness,email,phone};
  const score=scoreRealEstateLead(leadInput);
  const {data:lead,error:insertError}=await db.from("real_estate_leads").insert({
   workspace_id:form.workspace_id,source,source_event_id:sourceEventId,full_name:fullName,email,phone,
   transaction_type:transactionType,property_type:propertyType,preferred_location:preferredLocation,
   budget_min:budgetMin,budget_max:budgetMax,currency,
   bedrooms,
   timeframe,readiness,financing_notes:typeof body.financingNotes==="string"?body.financingNotes.slice(0,500):null,
   main_concern:typeof body.mainConcern==="string"?body.mainConcern.slice(0,500):null,
   contact_preference:contactPreference,consent_to_contact:body.consentToContact,
   consent_text:typeof body.consentText==="string"?body.consentText.slice(0,1000):null,
   consent_at:body.consentToContact?new Date().toISOString():null,status:"new",
   qualification:{},raw_enquiry:{message:typeof body.message==="string"?body.message.slice(0,6000):"",formId:form.id},
   lead_score:score.score,lead_temperature:score.temperature,score_factors:score.factors,
  }).select("*").single();
  if(insertError?.code==="23505"){const {data:duplicate}=await db.from("real_estate_leads").select("id,full_name,lead_score,status").eq("workspace_id",form.workspace_id).eq("source",source).eq("source_event_id",sourceEventId).maybeSingle();if(duplicate)return NextResponse.json({lead:duplicate,duplicate:true},{status:200,headers});}
  if(insertError)throw insertError;
  const followupsCreated=await ensurePublicLeadSideEffects(db,lead,form.workspace_id,form.id);
  let pipeline={enabled:false,claimed:0,completed:0,blocked:0,failed:0};
  try{pipeline=await processRealEstateLeadPipeline({db,workspaceId:form.workspace_id,leadId:lead.id});}
  catch(error){console.error("New enquiry pipeline queued for recovery",error);}
  return NextResponse.json({accepted:true,leadId:lead.id,score:lead.lead_score,temperature:lead.lead_temperature,followupsCreated,pipeline},{status:201,headers});
 }catch(error){console.error("Public real-estate intake failed",error);return NextResponse.json({error:"We could not submit this enquiry. Please contact the agency directly."},{status:500});}
}
