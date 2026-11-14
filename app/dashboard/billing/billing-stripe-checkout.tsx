"use client";
import {useState} from "react";
export default function BillingStripeCheckout({plan,enabled}:{plan:string;enabled:boolean}){
 const [busy,setBusy]=useState(false),[error,setError]=useState("");
 async function checkout(){
  setBusy(true);setError("");
  try{
   const response=await fetch("/api/billing/stripe/checkout",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({plan})});
   const data=await response.json();if(!response.ok||typeof data.url!=="string")throw new Error(data.error||"Stripe checkout is unavailable.");
   window.location.assign(data.url);
  }catch(e){setError(e instanceof Error?e.message:"Could not start Stripe checkout.");setBusy(false);}
 }
 return <div className="billing-stripe-checkout"><button type="button" disabled={!enabled||busy} onClick={()=>void checkout()}>{busy?"Opening Stripe…":"Pay with card · Stripe"}</button>{error&&<small role="alert">{error}</small>}</div>;
}
