import {NextResponse} from "next/server";
import {createClient} from "@/lib/supabase/server";
import {getOrCreateDefaultWorkspace} from "@/lib/supabase/workspace";
export const dynamic="force-dynamic";
function escapeHtml(value:unknown){return String(value??"").replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]??c));}
export async function GET(_request:Request,ctx:{params:Promise<{paymentId:string}>}){
 try{
  const supabase=await createClient(),{data:{user},error:authError}=await supabase.auth.getUser();
  if(authError||!user)return NextResponse.json({error:"Authentication required."},{status:401});
  const workspace=await getOrCreateDefaultWorkspace(supabase),{paymentId}=await ctx.params;
  const [{data:payment,error:paymentError},{data:workspaceRow,error:workspaceError}]=await Promise.all([
   supabase.from("billing_payments").select("id,reference,provider,plan_slug,amount_minor,currency,status,paid_at,created_at").eq("id",paymentId).eq("workspace_id",workspace.id).maybeSingle(),
   supabase.from("workspaces").select("name").eq("id",workspace.id).maybeSingle()
  ]);
  if(paymentError||workspaceError)throw paymentError??workspaceError;
  if(!payment||payment.status!=="success")return NextResponse.json({error:"Verified payment receipt not found."},{status:404});
  const amount=new Intl.NumberFormat("en",{style:"currency",currency:payment.currency}).format(payment.amount_minor/100);
  const html="<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Aivanta payment receipt</title><style>body{font:15px Arial,sans-serif;background:#f6f7f4;color:#26352b;padding:32px}.sheet{max-width:680px;margin:auto;background:#fff;padding:42px;border:1px solid #e5e9e2;border-radius:12px}h1{font-size:27px}small{color:#7f8b80}.line{display:flex;justify-content:space-between;border-bottom:1px solid #edf0eb;padding:14px 0;gap:20px}.total{font-size:21px;font-weight:bold}.print{margin-top:25px;padding:11px 16px;background:#26382d;color:white;border:0;border-radius:6px}@media print{body{background:white;padding:0}.sheet{border:0}}</style></head><body><main class=\"sheet\"><small>AIVANTA · PAYMENT CONFIRMATION</small><h1>Payment receipt</h1><p>Thank you. Your payment has been verified and applied to your workspace plan.</p><div class=\"line\"><span>Workspace</span><strong>"+escapeHtml(workspaceRow?.name??workspace.name)+"</strong></div><div class=\"line\"><span>Plan</span><strong>"+escapeHtml(payment.plan_slug.replaceAll("-"," "))+"</strong></div><div class=\"line\"><span>Payment provider</span><strong>"+escapeHtml(payment.provider)+"</strong></div><div class=\"line\"><span>Reference</span><strong>"+escapeHtml(payment.reference)+"</strong></div><div class=\"line\"><span>Paid on</span><strong>"+escapeHtml(new Date(payment.paid_at??payment.created_at).toLocaleString())+"</strong></div><div class=\"line total\"><span>Total paid</span><strong>"+escapeHtml(amount)+"</strong></div><small>This is a payment receipt, not a tax invoice. Tax documentation depends on Aivanta's registered billing entity and applicable local requirements.</small><br><button class=\"print\" onclick=\"window.print()\">Print / Save as PDF</button></main></body></html>";
  return new Response(html,{status:200,headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"private, no-store","Content-Disposition":"inline; filename=\"aivanta-payment-receipt.html\""}});
 }catch(error){console.error("Payment receipt generation failed:",error);return NextResponse.json({error:"Could not generate payment receipt."},{status:503});}
}
