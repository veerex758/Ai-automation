"use client";
import {useState} from "react";
export default function BillingPaystackMandate({plan,enabled}:{plan:string;enabled:boolean}){
 const [busy,setBusy]=useState(false),[error,setError]=useState("");
 const start=async()=>{setBusy(true);setError("");try{const r=await fetch("/api/billing/paystack/recurring/authorize",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({plan})});const d=await r.json();if(!r.ok||!d.authorizationUrl)throw new Error(d.error||"Paystack recurring authorization unavailable.");window.location.assign(d.authorizationUrl);}catch(e){setError(e instanceof Error?e.message:"Could not start authorization.");setBusy(false);}};
 return <div><button type="button" disabled={!enabled||busy} onClick={()=>void start()}>{busy?"Opening Paystack…":"Authorize Paystack · auto-renew"}</button>{error&&<small role="alert">{error}</small>}</div>;
}
