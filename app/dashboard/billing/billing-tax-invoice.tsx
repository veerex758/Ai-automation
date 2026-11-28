"use client";
import {useState} from "react";
export default function BillingTaxInvoice({paymentId}:{paymentId:string}){
 const [busy,setBusy]=useState(false),[error,setError]=useState("");
 const issue=async()=>{setBusy(true);setError("");try{const r=await fetch("/api/billing/invoices/"+paymentId+"/issue",{method:"POST"}),d=await r.json();if(!r.ok||!d.invoice?.id)throw new Error(d.error||"Invoice could not be issued.");window.open("/api/billing/invoice-docs/"+d.invoice.id,"_blank","noopener,noreferrer");}catch(e){setError(e instanceof Error?e.message:"Invoice issuance failed.");}finally{setBusy(false);}};
 return <div><button type="button" disabled={busy} onClick={()=>void issue()}>{busy?"Issuing…":"Issue tax invoice"}</button>{error&&<small role="alert">{error}</small>}</div>;
}
