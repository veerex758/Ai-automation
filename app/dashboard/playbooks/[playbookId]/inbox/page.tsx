"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import DashboardSidebar from "../../../dashboard-sidebar";
import "../../playbooks.css";

type Decision={id:string;lead_id:string;workflow_version:number;decision_type:string;step_id:string|null;node_id:string|null;operation_id:string|null;status:string;reason:string;requested_at:string;expires_at:string;lead:{id:string;full_name:string;source:string;lead_score:number;preferred_location:string|null}|null};
type Response={decisions?:Decision[];pendingCount?:number;error?:string};
const when=(value:string)=>new Date(value).toLocaleString(undefined,{dateStyle:"medium",timeStyle:"short"});
const title=(type:string)=>type.replaceAll("_"," ").replace(/\b\w/g,(c)=>c.toUpperCase());

export default function PlaybookDecisionInboxPage(){
 const params=useParams<{playbookId:string}>(),playbookId=params.playbookId;
 const [items,setItems]=useState<Decision[]>([]),[pending,setPending]=useState(0),[loading,setLoading]=useState(true),[busy,setBusy]=useState<string|null>(null),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const [corrections,setCorrections]=useState<Record<string,Record<string,string>>>({});
 const load=useCallback(async()=>{
  setLoading(true);setError("");
  try{
   const response=await fetch("/api/real-estate/playbooks/inbox?workflowId="+encodeURIComponent(playbookId),{cache:"no-store"});
   const data=await response.json() as Response;
   if(!response.ok)throw new Error(data.error||"Could not load the Decision Inbox.");
   setItems(data.decisions??[]);setPending(data.pendingCount??0);
  }catch(cause){setError(cause instanceof Error?cause.message:"Could not load the Decision Inbox.");}
  finally{setLoading(false);}
 },[playbookId]);
 useEffect(()=>{void load()},[load]);
 async function resolve(id:string,decision:"approved"|"rejected"){
  if(busy)return;setBusy(id);setError("");setNotice("");
  try{
   const draft=corrections[id]??{};
   const normalized:Record<string,string|number>={};
   for(const [key,value] of Object.entries(draft)){
    if(!value.trim())continue;
    normalized[key]=key==="budget_min"||key==="budget_max"?Number(value):value.trim();
   }
   const response=await fetch("/api/real-estate/playbooks/inbox/"+encodeURIComponent(id),{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify({decision,corrections:normalized})});
   const data=await response.json() as {success?:boolean;error?:string};
   if(!response.ok)throw new Error(data.error||"Decision could not be saved.");
   setNotice(decision==="approved"?"Approved. The enquiry has been returned to the durable queue; provider and consent checks run again.":"Rejected. The requested action will remain blocked.");
   await load();
  }catch(cause){setError(cause instanceof Error?cause.message:"Decision could not be saved.");}
  finally{setBusy(null);}
 }
 return <main className="app-shell playbook-shell">
  <DashboardSidebar activePage="playbooks"/>
  <section className="dashboard-main">
   <header className="dashboard-topbar"><div className="breadcrumbs">Workspace <span>/</span><Link href={"/dashboard/playbooks/"+encodeURIComponent(playbookId)}>Control Room</Link><span>/</span><strong>Decision Inbox</strong></div><span className="environment-badge">Human approval required</span></header>
   <div className="dashboard-content playbook-content">
    <div className="playbook-heading"><div className="playbook-eyebrow">REXNORA PLAYBOOKS · DECISION INBOX</div><h1>Decisions waiting for you</h1><p>Review uncertain enquiries and actions marked Ask me first. Approval is tied to the exact Playbook version and operation; the system rechecks safety before resuming.</p></div>
    <div className="playbook-steps"><div className="playbook-step"><span>{pending}</span><div><strong>Pending decisions</strong><small>Waiting for your review</small></div></div><div className="playbook-step"><span>{items.length}</span><div><strong>Recent decisions</strong><small>Including resolved and expired items</small></div></div><div className="playbook-step"><span>7d</span><div><strong>Approval expiry</strong><small>Old requests must be reviewed again</small></div></div></div>
    {error&&<div className="playbook-alert error" role="alert">{error}</div>}{notice&&<div className="playbook-alert" role="status">{notice}</div>}
    {loading&&<div className="playbook-panel">Loading decisions…</div>}
    {!loading&&!items.length&&<div className="playbook-panel"><div className="playbook-empty">Nothing needs a decision yet. When an enquiry is uncertain or an action needs approval, it will appear here.</div></div>}
    {!loading&&items.map(item=><article className="playbook-panel" key={item.id}>
     <div className="playbook-review-heading"><div><div className="playbook-eyebrow">{title(item.decision_type)} · VERSION {item.workflow_version}</div><h2>{item.lead?.full_name||"Enquiry"}</h2><p>{item.reason}</p></div><span className="playbook-draft-tag">{title(item.status)}</span></div>
     <div className="playbook-threshold"><span><strong>{item.node_id||"Human review"}{item.operation_id?" · "+item.operation_id:""}</strong><small>{item.lead?.source||"Lead"} · {item.lead?.preferred_location||"Location not supplied"} · Score {item.lead?.lead_score??"—"}</small></span><span>Requested {when(item.requested_at)}</span></div>
     {item.status==="pending"&&item.decision_type==="qualification_review"&&<div className="playbook-correction-grid">
      <div><strong>Correct extracted details (optional)</strong><small>Leave a field blank to keep its current value.</small></div>
      <label>Preferred location<input value={corrections[item.id]?.preferred_location??""} onChange={event=>setCorrections(current=>({...current,[item.id]:{...current[item.id],preferred_location:event.target.value}}))} placeholder="Correct location"/></label>
      <label>Minimum budget<input type="number" min="0" value={corrections[item.id]?.budget_min??""} onChange={event=>setCorrections(current=>({...current,[item.id]:{...current[item.id],budget_min:event.target.value}}))} placeholder="Optional"/></label>
      <label>Maximum budget<input type="number" min="0" value={corrections[item.id]?.budget_max??""} onChange={event=>setCorrections(current=>({...current,[item.id]:{...current[item.id],budget_max:event.target.value}}))} placeholder="Optional"/></label>
      <label>Transaction type<select value={corrections[item.id]?.transaction_type??""} onChange={event=>setCorrections(current=>({...current,[item.id]:{...current[item.id],transaction_type:event.target.value}}))}><option value="">Keep current</option><option value="buy">Buy</option><option value="rent">Rent</option><option value="invest">Invest</option><option value="sell">Sell</option><option value="unknown">Unknown</option></select></label>
      <label>Property type<select value={corrections[item.id]?.property_type??""} onChange={event=>setCorrections(current=>({...current,[item.id]:{...current[item.id],property_type:event.target.value}}))}><option value="">Keep current</option><option value="apartment">Apartment</option><option value="house">House</option><option value="land">Land</option><option value="commercial">Commercial</option><option value="other">Other</option><option value="unknown">Unknown</option></select></label>
      <label>Timeframe<select value={corrections[item.id]?.timeframe??""} onChange={event=>setCorrections(current=>({...current,[item.id]:{...current[item.id],timeframe:event.target.value}}))}><option value="">Keep current</option><option value="urgent">Urgent</option><option value="within_30_days">Within 30 days</option><option value="one_to_three_months">1–3 months</option><option value="over_three_months">Over 3 months</option><option value="unknown">Unknown</option></select></label>
      <label>Readiness<select value={corrections[item.id]?.readiness??""} onChange={event=>setCorrections(current=>({...current,[item.id]:{...current[item.id],readiness:event.target.value}}))}><option value="">Keep current</option><option value="cash_ready">Cash ready</option><option value="pre_approved">Pre-approved</option><option value="financing_needed">Needs financing</option><option value="researching">Researching</option><option value="unknown">Unknown</option></select></label>
     </div>}
     {item.status==="pending"&&<div className="playbook-save-row"><div><strong>What happens next?</strong><small>Approve re-queues the enquiry with any corrections. Credentials, consent, connection validation and idempotency are checked again before an action.</small></div><div className="playbook-actions"><button type="button" className="playbook-secondary-button" disabled={busy!==null} onClick={()=>void resolve(item.id,"rejected")}>{busy===item.id?"Saving…":"Reject"}</button><button type="button" className="playbook-primary" disabled={busy!==null} onClick={()=>void resolve(item.id,"approved")}>{busy===item.id?"Saving…":"Approve & resume"}</button></div></div>}
     {item.status!=="pending"&&<p className="playbook-footnote">This decision is no longer actionable.</p>}
    </article>)}
   </div>
  </section>
 </main>;
}
