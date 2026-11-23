import Stripe from "stripe";
import {NextResponse} from "next/server";
import {createClient} from "@/lib/supabase/server";
import {createAdminClient} from "@/lib/supabase/admin";
import {getOrCreateDefaultWorkspace,getWorkspaceRole,canManageWorkspaceBilling} from "@/lib/supabase/workspace";
import {decryptWebhookSecret} from "@/lib/webhooks/secret-crypto";

export const dynamic="force-dynamic";
export const runtime="nodejs";

export async function POST(){
 const supabase=await createClient();
 const {data:{user},error:authError}=await supabase.auth.getUser();
 if(authError||!user)return NextResponse.json({error:"Authentication required."},{status:401,headers:{"Cache-Control":"private,no-store"}});
 try{
  const workspace=await getOrCreateDefaultWorkspace(supabase);
  const role=await getWorkspaceRole(supabase,workspace.id,user.id);
  if(!canManageWorkspaceBilling(role))return NextResponse.json({error:"Only a workspace owner or admin can manage billing."},{status:403});
  const admin=createAdminClient();
  const {data:subscription,error:subscriptionError}=await admin.from("workspace_subscriptions")
   .select("workspace_id,plan_key,status,billing_provider,provider_subscription_id,current_period_end,cancel_at_period_end,auto_renew")
   .eq("workspace_id",workspace.id).maybeSingle();
  if(subscriptionError)throw subscriptionError;
  if(!subscription||subscription.plan_key==="free"||subscription.status==="canceled"){
   return NextResponse.json({error:"There is no active paid subscription to cancel."},{status:409,headers:{"Cache-Control":"private,no-store"}});
  }
  if(subscription.cancel_at_period_end){
   return NextResponse.json({cancellation:{success:true,already_scheduled:true,access_until:subscription.current_period_end}},{headers:{"Cache-Control":"private,no-store"}});
  }

  // Stop future provider charges first. Only mark local cancellation after the provider confirms.
  if(subscription.billing_provider==="stripe"&&subscription.provider_subscription_id){
   const stripeSecret=process.env.STRIPE_SECRET_KEY;
   if(!stripeSecret)return NextResponse.json({error:"Stripe cancellation is not configured on this server."},{status:503});
   const stripe=new Stripe(stripeSecret);
   const providerSubscription=await stripe.subscriptions.retrieve(subscription.provider_subscription_id);
   if(!providerSubscription.cancel_at_period_end&&providerSubscription.status!=="canceled"){
    await stripe.subscriptions.update(subscription.provider_subscription_id,{cancel_at_period_end:true});
   }
  }else if(subscription.billing_provider==="paystack"&&subscription.auto_renew){
   const secret=process.env.PAYSTACK_SECRET_KEY,key=process.env.AIVANTA_CREDENTIALS_ENCRYPTION_KEY;
   if(!secret||!key)return NextResponse.json({error:"Paystack recurring cancellation is not configured on this server."},{status:503});
   const {data:customer,error:customerError}=await admin.from("workspace_billing_customers")
    .select("paystack_authorization_code_enc").eq("workspace_id",workspace.id).maybeSingle();
   if(customerError)throw customerError;
   if(!customer?.paystack_authorization_code_enc)return NextResponse.json({error:"The saved Paystack authorization is unavailable. Renewal has not been marked as canceled."},{status:503});
   const authorizationCode=decryptWebhookSecret(Buffer.from(customer.paystack_authorization_code_enc,"base64"),key);
   const response=await fetch("https://api.paystack.co/customer/authorization/deactivate",{
    method:"POST",headers:{Authorization:"Bearer "+secret,"Content-Type":"application/json"},
    body:JSON.stringify({authorization_code:authorizationCode}),cache:"no-store",signal:AbortSignal.timeout(15000)
   });
   let result:{status?:boolean;message?:string}={};
   try{result=await response.json() as {status?:boolean;message?:string};}catch{/* Keep cancellation unconfirmed. */}
   if(!response.ok||result.status!==true){
    console.error("Paystack authorization deactivation was not confirmed:",response.status,result.message);
    return NextResponse.json({error:"Paystack did not confirm cancellation. Automatic renewal remains unchanged."},{status:502});
   }
   const {error:disableError}=await admin.from("workspace_billing_customers")
    .update({recurring_enabled:false,updated_at:new Date().toISOString()}).eq("workspace_id",workspace.id);
   if(disableError)throw disableError;
  }

  const {data,error:cancelError}=await supabase.rpc("request_workspace_subscription_cancellation",{p_workspace_id:workspace.id});
  if(cancelError){
   if(cancelError.code==="42501")return NextResponse.json({error:"Only a workspace owner or admin can manage billing."},{status:403});
   throw cancelError;
  }
  if(!data?.success){
   const reason=data?.reason==="subscription_not_found"?"No paid subscription exists for this workspace.":"There is no active paid subscription to cancel.";
   return NextResponse.json({error:reason},{status:409,headers:{"Cache-Control":"private,no-store"}});
  }
  const {error:consentError}=await admin.from("billing_recurring_consents")
   .update({status:"revoked",revoked_at:new Date().toISOString(),updated_at:new Date().toISOString()})
   .eq("workspace_id",workspace.id).in("status",["active","pending"]);
  if(consentError)throw consentError;
  return NextResponse.json({cancellation:data},{headers:{"Cache-Control":"private,no-store"}});
 }catch(error){
  console.error("Workspace subscription cancellation failed:",error);
  return NextResponse.json({error:"Could not safely cancel automatic renewal. No cancellation success is being reported."},{status:503,headers:{"Cache-Control":"private,no-store"}});
 }
}
