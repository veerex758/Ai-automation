import {NextResponse} from "next/server";
import {createClient} from "@/lib/supabase/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {getOrCreateDefaultWorkspace,getWorkspaceRole,canManageWorkspaceBilling} from "@/lib/supabase/workspace";
export const runtime="nodejs";
export async function POST(_request:Request,ctx:{params:Promise<{paymentId:string}>}){
 try{
  const supabase=await createClient(),{data:{user}}=await supabase.auth.getUser();if(!user)return NextResponse.json({error:"Authentication required."},{status:401});
  const workspace=await getOrCreateDefaultWorkspace(supabase),role=await getWorkspaceRole(supabase,workspace.id,user.id);
  if(!canManageWorkspaceBilling(role))return NextResponse.json({error:"Workspace billing permission required."},{status:403});
  const {paymentId}=await ctx.params,admin=createAdminClient();
  const [{data:payment,error:paymentError},{data:workspaceRow,error:workspaceError},{data:customer,error:customerError}]=await Promise.all([
   admin.from("billing_payments").select("id,workspace_id,reference,plan_slug,amount_minor,currency,status,paid_at").eq("id",paymentId).eq("workspace_id",workspace.id).maybeSingle(),
   admin.from("workspaces").select("id,name").eq("id",workspace.id).maybeSingle(),
   admin.from("workspace_billing_customers").select("billing_customer_details").eq("workspace_id",workspace.id).maybeSingle()
  ]);
  if(paymentError||workspaceError||customerError)throw paymentError??workspaceError??customerError;
  if(!payment||payment.status!=="success")return NextResponse.json({error:"Only verified paid transactions can be invoiced."},{status:409});
  const {data:existing,error:existingError}=await admin.from("billing_invoices").select("id,invoice_number,status").eq("payment_id",payment.id).maybeSingle();if(existingError)throw existingError;
  if(existing)return NextResponse.json({invoice:existing,alreadyIssued:true});
  const sellerName=process.env.AIVANTA_LEGAL_ENTITY_NAME,sellerAddress=process.env.AIVANTA_LEGAL_ENTITY_ADDRESS,jurisdiction=process.env.AIVANTA_TAX_JURISDICTION;
  if(!sellerName||!sellerAddress||!jurisdiction)return NextResponse.json({error:"Invoice issuance is not configured: legal seller name, registered address and tax jurisdiction are required."},{status:503});
  const {data:taxRule,error:taxError}=await admin.from("billing_tax_rules").select("id,jurisdiction,tax_code,display_name,rate_basis_points,inclusive,valid_from,valid_until").eq("jurisdiction",jurisdiction).eq("enabled",true).lte("valid_from",new Date().toISOString().slice(0,10)).or("valid_until.is.null,valid_until.gte."+new Date().toISOString().slice(0,10)).order("valid_from",{ascending:false}).limit(1).maybeSingle();
  if(taxError)throw taxError;
  const amount=payment.amount_minor,rate=taxRule?.rate_basis_points??0,inclusive=Boolean(taxRule?.inclusive);
  const subtotal=inclusive?Math.round(amount*10000/(10000+rate)):amount,tax=inclusive?amount-subtotal:Math.round(amount*rate/10000),total=inclusive?amount:amount+tax;
  const customerDetails=customer?.billing_customer_details??{},customerSnapshot={name:customerDetails.name??user.user_metadata?.full_name??user.email??"Customer",email:customerDetails.email??user.email??null,address:customerDetails.address??null,tax_id:customerDetails.tax_id??null,workspace:workspaceRow?.name??workspace.name};
  const sellerSnapshot={legal_name:sellerName,address:sellerAddress,tax_registration_id:process.env.AIVANTA_TAX_REGISTRATION_ID??null,country:process.env.AIVANTA_LEGAL_ENTITY_COUNTRY??null};
  const numberResult=await admin.rpc("next_workspace_invoice_number",{p_workspace_id:workspace.id});if(numberResult.error)throw numberResult.error;
  const invoiceNumber=numberResult.data as string;
  const {data:invoice,error:insertError}=await admin.from("billing_invoices").insert({workspace_id:workspace.id,payment_id:payment.id,invoice_number:invoiceNumber,status:"issued",currency:payment.currency,seller:sellerSnapshot,customer:customerSnapshot,tax_jurisdiction:jurisdiction,tax_registration_id:process.env.AIVANTA_TAX_REGISTRATION_ID??null,tax_rule_snapshot:taxRule?{id:taxRule.id,code:taxRule.tax_code,name:taxRule.display_name,rate_basis_points:rate,inclusive,valid_from:taxRule.valid_from,valid_until:taxRule.valid_until}:{code:"zero_or_unconfigured",rate_basis_points:0},line_items:[{description:"Aivanta "+payment.plan_slug.replaceAll("-"," ")+" subscription",quantity:1,unit_amount_minor:subtotal,subtotal_minor:subtotal,tax_minor:tax,total_minor:total}],subtotal_minor:subtotal,tax_minor:tax,total_minor:total,issued_at:new Date().toISOString(),paid_at:payment.paid_at});
  if(insertError){if(insertError.code==="23505"){const {data:race}=await admin.from("billing_invoices").select("id,invoice_number,status").eq("payment_id",payment.id).maybeSingle();if(race)return NextResponse.json({invoice:race,alreadyIssued:true});}throw insertError;}
  return NextResponse.json({invoice},{status:201,headers:{"Cache-Control":"private,no-store"}});
 }catch(error){console.error("Invoice issuance failed:",error);return NextResponse.json({error:"Could not issue invoice."},{status:503});}
}
