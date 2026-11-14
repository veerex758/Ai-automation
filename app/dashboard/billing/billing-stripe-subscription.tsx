"use client";
import {useState} from "react";
export default function BillingStripeSubscription({plan,enabled}:{plan:string;enabled:boolean}){
 const [busy,setBusy]=useState(false),[error,setError]=useState("");
 const start=async()=>{setBusy(true);setError("");try{const r=await fetch("/api/billing/stripe/subscribe",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({plan})});const d=await r.json();if(!r.ok||!d.url)throw new Error(d.error||"Stripe subscription checkout unavailable.");window.location.assign(d.url);}catch(e){setError(e instanceof Error?e.message:"Could not start subscription.");setBusy(false);}};
 return <div><button type="button" disabled={!enabled||busy} onClick={()=>void start()}>{busy?"Opening Stripe…":"Subscribe with Stripe · auto-renew"}</button>{error&&<small role="alert">{error}</small>}</div>;
}
