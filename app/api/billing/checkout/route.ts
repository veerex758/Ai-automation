import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
import { createAdminClient } from "@/lib/supabase/admin";
import { createPaymentReference, getPaidPlan } from "@/lib/billing/paystack";
export const runtime = "nodejs";
export async function POST(request: Request) {
 try {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({error:"Authentication required."},{status:401});
  const body = await request.json();
  const plan = getPaidPlan(body?.plan);
  if (!plan) return NextResponse.json({error:"Invalid paid plan."},{status:400});
  const workspace = await getOrCreateDefaultWorkspace(client);
  const reference = createPaymentReference();
  const admin = createAdminClient();
  const {error} = await admin.from("billing_payments").insert({workspace_id:workspace.id,user_id:user.id,reference,plan_slug:plan.slug,amount_minor:plan.amountMinor,currency:plan.currency,status:"pending"});
  if (error) throw error;
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) return NextResponse.json({error:"Payment provider is not configured."},{status:503});
  const response = await fetch("https://api.paystack.co/transaction/initialize",{method:"POST",headers:{Authorization:"Bearer "+secret,"Content-Type":"application/json"},body:JSON.stringify({email:user.email,amount:plan.amountMinor,currency:plan.currency,reference,callback_url:new URL("/dashboard/billing/verify",request.url).toString(),metadata:{workspace_id:workspace.id,user_id:user.id,plan_slug:plan.slug}}),cache:"no-store"});
  const result = await response.json();
  if (!response.ok || result.status !== true) throw new Error("Checkout initialization failed.");
  await admin.from("billing_payments").update({authorization_url:result.data.authorization_url,access_code:result.data.access_code}).eq("reference",reference);
  return NextResponse.json({authorizationUrl:result.data.authorization_url,reference},{headers:{"Cache-Control":"private, no-store"}});
 } catch (error) { console.error("Billing checkout failed:",error); return NextResponse.json({error:"Could not start checkout."},{status:500}); }
}
