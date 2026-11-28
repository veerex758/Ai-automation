"use client";
import {useState} from "react";

function formatPrice(amountMinor:number,currency:string){
 try{return new Intl.NumberFormat(undefined,{style:"currency",currency}).format(amountMinor/100);}
 catch{return currency+" "+(amountMinor/100).toFixed(2);}
}
export default function BillingStripeSubscription({plan,enabled,amountMinor,currency}:{plan:string;enabled:boolean;amountMinor:number;currency:string}){
 const [consented,setConsented]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const cadence=plan.endsWith("-annual")?"year":"month";
 const start=async()=>{
  if(!consented)return;
  setBusy(true);setError("");
  try{
   const response=await fetch("/api/billing/stripe/subscribe",{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({plan,consent:true})
   });
   const payload=await response.json();
   if(!response.ok||!payload.url)throw new Error(payload.error||"Stripe subscription checkout unavailable.");
   window.location.assign(payload.url);
  }catch(cause){setError(cause instanceof Error?cause.message:"Could not start subscription.");setBusy(false);}
 };
 return <div className="billing-recurring-consent">
  <label>
   <input type="checkbox" checked={consented} disabled={!enabled||busy} onChange={event=>setConsented(event.target.checked)}/>
   I authorize Stripe to charge {formatPrice(amountMinor,currency)} every {cadence}. The subscription renews until I cancel; cancellation stops future renewal and preserves access through the paid period.
  </label>
  <button type="button" disabled={!enabled||busy||!consented} onClick={()=>void start()}>{busy?"Opening Stripe…":"Subscribe with Stripe · auto-renew"}</button>
  {error&&<small role="alert">{error}</small>}
 </div>;
}
