"use client";
import { useCallback,useEffect,useMemo,useState,type FormEvent } from "react";
import DashboardSidebar from "../dashboard-sidebar";
import "./real-estate.css";

type Stats={total:number;newLeads:number;qualified:number;hot:number;warm:number;cold:number;viewings:number;won:number;lost:number;properties:number;activeProperties:number;followupsDue:number;agents:number};
type Lead={id:string;source:string;full_name:string;email:string|null;phone:string|null;transaction_type:string;property_type:string;preferred_location:string|null;budget_min:number|null;budget_max:number|null;currency:string;timeframe:string;readiness:string;lead_score:number;score_factors?:Array<{key:string;label:string;points:number;maximum:number;reason:string}>;lead_temperature:string;status:string;assigned_agent_id:string|null;consent_to_contact:boolean;customer_responded_at:string|null;agent_takeover_at:string|null;created_at:string;updated_at:string};
type Property={id:string;reference:string;title:string;property_type:string;transaction_type:string;location:string;price:number;currency:string;bedrooms:number|null;availability_status:string;available:boolean;last_verified_at:string|null;listing_url:string|null};
type Followup={id:string;lead_id:string;sequence:number;channel:string;due_at:string;status:string;subject:string;sent_at:string|null;last_error_code:string|null;attempt_count:number;max_attempts:number;lead:Pick<Lead,"id"|"full_name"|"email"|"status"|"lead_score"|"consent_to_contact"|"customer_responded_at"|"agent_takeover_at">|null};
type Agent={id:string;name:string;status:string};
type IntakeForm={id:string;name:string;default_source:string;allowed_origins:string[];enabled:boolean;created_at:string};
type NotificationRecipient={id:string;email:string;active:boolean;approved_at:string;created_at:string;revoked_at:string|null};
type Activity={id:string;lead_id:string;activity_type:string;details:Record<string,unknown>;created_at:string};
type Detail={lead:Lead;activities:Activity[];followups:Array<Omit<Followup,"lead">>};
type Tab="leads"|"properties"|"followups"|"forms";
const emptyStats:Stats={total:0,newLeads:0,qualified:0,hot:0,warm:0,cold:0,viewings:0,won:0,lost:0,properties:0,activeProperties:0,followupsDue:0,agents:0};
const blankLead={fullName:"",email:"",phone:"",transactionType:"buy",propertyType:"apartment",preferredLocation:"",budgetMin:"",budgetMax:"",currency:"USD",timeframe:"unknown",readiness:"unknown",contactPreference:"email",consentToContact:false,consentText:""};
const blankProperty={reference:"",title:"",propertyType:"apartment",transactionType:"sale",location:"",price:"",currency:"USD",bedrooms:"",availabilityStatus:"available",listingUrl:""};
async function requestJson<T>(url:string,init?:RequestInit):Promise<T>{
 const response=await fetch(url,{...init,cache:"no-store",headers:{"Content-Type":"application/json",...(init?.headers??{})}});
 let data:unknown;try{data=await response.json()}catch{data={};}
 if(!response.ok)throw new Error(data&&typeof data==="object"&&"error"in data?String((data as {error:unknown}).error):"Request failed.");
 return data as T;
}
const dateLabel=(value:string)=>new Date(value).toLocaleString(undefined,{dateStyle:"medium",timeStyle:"short"});
const money=(value:number|null,currency:string)=>value===null?"Not set":new Intl.NumberFormat(undefined,{style:"currency",currency,maximumFractionDigits:0}).format(value);
const label=(value:string)=>value.replaceAll("_"," ").replace(/\b\w/g,c=>c.toUpperCase());

export default function RealEstatePage(){
 const [tab,setTab]=useState<Tab>("leads"),[stats,setStats]=useState<Stats>(emptyStats),[leads,setLeads]=useState<Lead[]>([]),[properties,setProperties]=useState<Property[]>([]);
 const [followups,setFollowups]=useState<Followup[]>([]),[forms,setForms]=useState<IntakeForm[]>([]),[agents,setAgents]=useState<Agent[]>([]);
 const [notificationRecipients,setNotificationRecipients]=useState<NotificationRecipient[]>([]),[recipientError,setRecipientError]=useState(""),[newRecipientEmail,setNewRecipientEmail]=useState("");
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const [search,setSearch]=useState(""),[statusFilter,setStatusFilter]=useState("all"),[selected,setSelected]=useState<Detail|null>(null);
 const [propertyMatches,setPropertyMatches]=useState<Array<{property:Property;score:number;reasons:string[]}>>([]),[matching,setMatching]=useState(false);
 const [showLeadForm,setShowLeadForm]=useState(false),[showPropertyForm,setShowPropertyForm]=useState(false),[showIntakeForm,setShowIntakeForm]=useState(false);
 const [leadForm,setLeadForm]=useState(blankLead),[propertyForm,setPropertyForm]=useState(blankProperty),[intakeName,setIntakeName]=useState("Website enquiry"),[origins,setOrigins]=useState("https://");
 const [oneTimeKey,setOneTimeKey]=useState<{endpoint:string;publicKey:string}|null>(null);

 const load=useCallback(async()=>{
  setLoading(true);setError("");setRecipientError("");
  try{
   const [dash,leadData,propertyData,followupData,formData,agentData,recipientData]=await Promise.all([
    requestJson<{stats:Stats}>("/api/real-estate/dashboard"),
    requestJson<{leads:Lead[]}>("/api/real-estate/leads?limit=100"),
    requestJson<{properties:Property[]}>("/api/real-estate/properties"),
    requestJson<{followups:Followup[]}>("/api/real-estate/followups"),
    requestJson<{forms:IntakeForm[]}>("/api/real-estate/intake-forms"),
    requestJson<{agents:Agent[]}>("/api/agents"),
    requestJson<{recipients:NotificationRecipient[]}>("/api/real-estate/notification-recipients").catch(cause=>{setRecipientError(cause instanceof Error?cause.message:"Agency alert recipient approvals are unavailable.");return {recipients:[]};}),
   ]);
   setStats(dash.stats??emptyStats);setLeads(leadData.leads??[]);setProperties(propertyData.properties??[]);
   setFollowups(followupData.followups??[]);setForms(formData.forms??[]);setAgents(agentData.agents??[]);setNotificationRecipients(recipientData.recipients??[]);
  }catch(cause){setError(cause instanceof Error?cause.message:"Could not load the real-estate workspace.");}
  finally{setLoading(false);}
 },[]);
 useEffect(()=>{void load()},[load]);
 useEffect(()=>{if(window.location.hash==="#followups")setTab("followups")},[]);

 const visibleLeads=useMemo(()=>leads.filter(lead=>(lead.full_name+" "+(lead.email??"")+" "+(lead.preferred_location??"")).toLowerCase().includes(search.toLowerCase())&&(statusFilter==="all"||lead.status===statusFilter)),[leads,search,statusFilter]);
 async function showLead(lead:Lead){
  setError("");setNotice("");
  try{const detail=await requestJson<Detail>("/api/real-estate/leads/"+lead.id);setSelected(detail);}
  catch(cause){setError(cause instanceof Error?cause.message:"Could not open lead.");}
 }
 async function findProperties(leadId:string){
  setMatching(true);setError("");setNotice("");setPropertyMatches([]);
  try{const result=await requestJson<{matches:Array<{property:Property;score:number;reasons:string[]}>;checkedListings:number}>("/api/real-estate/leads/"+leadId+"/matches");setPropertyMatches(result.matches??[]);setNotice((result.matches?.length??0)+" verified property matches found from "+(result.checkedListings??0)+" available listings.");}
  catch(cause){setError(cause instanceof Error?cause.message:"Could not find properties for this lead.");}
  finally{setMatching(false);}
 }
 async function patchLead(id:string,body:Record<string,unknown>){
  setBusy(true);setError("");setNotice("");
  try{await requestJson("/api/real-estate/leads/"+id,{method:"PATCH",body:JSON.stringify(body)});setNotice("Lead updated.");await load();const detail=await requestJson<Detail>("/api/real-estate/leads/"+id);setSelected(detail);}
  catch(cause){setError(cause instanceof Error?cause.message:"Update failed.");}
  finally{setBusy(false);}
 }
 async function createLead(event:FormEvent<HTMLFormElement>){
  event.preventDefault();setBusy(true);setError("");setNotice("");
  try{
   const body={...leadForm,budgetMin:leadForm.budgetMin===""?null:Number(leadForm.budgetMin),budgetMax:leadForm.budgetMax===""?null:Number(leadForm.budgetMax),source:"manual",consentText:leadForm.consentToContact?leadForm.consentText.trim():null};
   await requestJson("/api/real-estate/leads",{method:"POST",body:JSON.stringify(body)});
   setLeadForm(blankLead);setShowLeadForm(false);setNotice("Lead created.");await load();
  }catch(cause){setError(cause instanceof Error?cause.message:"Lead creation failed.");}
  finally{setBusy(false);}
 }
 async function createProperty(event:FormEvent<HTMLFormElement>){
  event.preventDefault();setBusy(true);setError("");
  try{await requestJson("/api/real-estate/properties",{method:"POST",body:JSON.stringify({...propertyForm,price:Number(propertyForm.price),bedrooms:propertyForm.bedrooms===""?null:Number(propertyForm.bedrooms)})});
   setPropertyForm(blankProperty);setShowPropertyForm(false);setNotice("Property listing saved.");await load();
  }catch(cause){setError(cause instanceof Error?cause.message:"Property could not be saved.");}
  finally{setBusy(false);}
 }
 async function createIntake(event:FormEvent<HTMLFormElement>){
  event.preventDefault();setBusy(true);setError("");setOneTimeKey(null);
  try{const result=await requestJson<{endpoint:string;publicKey:string}>("/api/real-estate/intake-forms",{method:"POST",body:JSON.stringify({name:intakeName,defaultSource:"website",allowedOrigins:origins.split(",").map(x=>x.trim()).filter(Boolean)})});
   setOneTimeKey(result);setShowIntakeForm(false);setNotice("Website form created. Copy its public key now; it is shown only once.");await load();
  }catch(cause){setError(cause instanceof Error?cause.message:"Intake form could not be created.");}
  finally{setBusy(false);}
 }
 async function updateProperty(id:string,availabilityStatus:string){
  setBusy(true);setError("");
  try{await requestJson("/api/real-estate/properties/"+id,{method:"PATCH",body:JSON.stringify({availabilityStatus})});setNotice("Property availability updated.");await load();}
  catch(cause){setError(cause instanceof Error?cause.message:"Property update failed.");}
  finally{setBusy(false);}
 }
 async function approveRecipient(event:FormEvent<HTMLFormElement>){
  event.preventDefault();setBusy(true);setError("");setNotice("");
  try{
   await requestJson("/api/real-estate/notification-recipients",{method:"POST",body:JSON.stringify({email:newRecipientEmail})});
   setNewRecipientEmail("");setNotice("Agency alert recipient explicitly approved.");await load();
  }catch(cause){setError(cause instanceof Error?cause.message:"Recipient could not be approved.");}
  finally{setBusy(false);}
 }
 async function changeRecipientApproval(recipient:NotificationRecipient,active:boolean){
  if(!active&&!window.confirm("Revoke future Rexnora lead alerts for "+recipient.email+"?"))return;
  setBusy(true);setError("");setNotice("");
  try{
   await requestJson("/api/real-estate/notification-recipients/"+recipient.id,{method:"PATCH",body:JSON.stringify({active})});
   setNotice(active?"Agency alert recipient re-approved.":"Agency alert recipient revoked.");await load();
  }catch(cause){setError(cause instanceof Error?cause.message:"Recipient approval could not be updated.");}
  finally{setBusy(false);}
 }

 async function updateForm(form:IntakeForm,enabled:boolean){
  setBusy(true);setError("");
  try{await requestJson("/api/real-estate/intake-forms/"+form.id,{method:"PATCH",body:JSON.stringify({enabled})});setNotice("Intake form updated.");await load();}
  catch(cause){setError(cause instanceof Error?cause.message:"Form update failed.");}
  finally{setBusy(false);}
 }
 const dueCount=followups.filter(x=>x.status==="pending"&&new Date(x.due_at)<=new Date()).length;
 const copy=async(value:string)=>{try{await navigator.clipboard.writeText(value);setNotice("Copied to clipboard.");}catch{setError("Clipboard access failed. Select and copy the text manually.");}};

 return <main className="app-shell re-shell">
  <DashboardSidebar activePage="realestate"/>
  <section className="dashboard-main">
   <header className="dashboard-topbar"><div className="breadcrumbs">Workspace / <strong>Real Estate</strong></div><span className="environment-badge">Lead engine</span></header>
   <div className="dashboard-content re-content">
    <div className="re-heading"><div><div className="dash-eyebrow">REAL ESTATE WORKSPACE</div><h1>Lead Management</h1><p>Capture enquiries, prioritize serious prospects and keep every agent action visible.</p></div><div style={{display:"flex",gap:8,flexWrap:"wrap"}}><a className="re-secondary" href="/dashboard/real-estate/operations">Operations</a><button className="re-primary" onClick={()=>{setShowLeadForm(true);setShowPropertyForm(false);setShowIntakeForm(false)}}>＋ Add lead</button></div></div>
    {error&&<div className="re-alert re-error" role="alert">{error}</div>}
    {notice&&<div className="re-alert" role="status">{notice}<button onClick={()=>setNotice("")} aria-label="Dismiss message">×</button></div>}
    {oneTimeKey&&<section className="re-key-card"><div><strong>New website intake key — shown once</strong><p>Save this key securely. It will not be displayed again.</p></div><div className="re-key-value"><span>{oneTimeKey.publicKey}</span><button onClick={()=>void copy(oneTimeKey.publicKey)}>Copy key</button></div><div className="re-key-value"><span>{oneTimeKey.endpoint}</span><button onClick={()=>void copy(window.location.origin+oneTimeKey.endpoint)}>Copy endpoint</button></div><button className="re-link" onClick={()=>setOneTimeKey(null)}>Dismiss</button></section>}
    <div className="re-stats">
     <article><span>Total enquiries</span><strong>{stats.total}</strong><small>{stats.newLeads} new</small></article>
     <article><span>Hot leads</span><strong>{stats.hot}</strong><small>80–100 score</small></article>
     <article><span>Warm leads</span><strong>{stats.warm}</strong><small>50–79 score</small></article>
     <article><span>Follow-ups due</span><strong>{dueCount||stats.followupsDue}</strong><small>{followups.filter(x=>x.status==="pending").length} pending</small></article>
     <article><span>Viewings</span><strong>{stats.viewings}</strong><small>Scheduled</small></article>
     <article><span>Closed won</span><strong>{stats.won}</strong><small>{stats.lost} lost</small></article>
     <article><span>Properties</span><strong>{stats.activeProperties}</strong><small>{stats.properties} total listings</small></article>
     <article><span>Agents</span><strong>{stats.agents}</strong><small>In this workspace</small></article>
    </div>
    <div className="re-tabs" role="tablist" aria-label="Real estate sections">
     {(["leads","properties","followups","forms"] as Tab[]).map(item=><button key={item} role="tab" aria-selected={tab===item} className={tab===item?"active":""} onClick={()=>setTab(item)}>{({leads:"Leads",properties:"Property inventory",followups:"Follow-ups",forms:"Website forms"} as Record<Tab,string>)[item]}</button>)}
    </div>

    {tab==="leads"&&<section className="re-panel">
     <div className="re-panel-head"><div><h2>Enquiry pipeline</h2><p>Sort by lead score and keep ownership inside the workspace.</p></div><div className="re-tools"><input aria-label="Search leads" placeholder="Search by name or location" value={search} onChange={e=>setSearch(e.target.value)}/><select aria-label="Filter by status" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="all">All statuses</option>{["new","qualified","contacted","viewing_scheduled","negotiation","won","lost"].map(x=><option key={x} value={x}>{label(x)}</option>)}</select></div></div>
     <div className="re-table-wrap"><table className="re-table"><thead><tr><th>Customer</th><th>Requirement</th><th>Score</th><th>Status</th><th>Source</th><th>Added</th><th></th></tr></thead><tbody>
      {visibleLeads.map(lead=><tr key={lead.id}><td><button className="re-customer" onClick={()=>void showLead(lead)}><strong>{lead.full_name}</strong><small>{lead.email??lead.phone??"No contact"}</small></button></td><td><strong>{label(lead.transaction_type)} · {label(lead.property_type)}</strong><small>{lead.preferred_location??"Location missing"}</small></td><td><span className={"re-score "+lead.lead_temperature}>{lead.lead_score}</span></td><td><span className={"re-status "+lead.status}>{label(lead.status)}</span></td><td>{label(lead.source)}</td><td>{dateLabel(lead.created_at)}</td><td><button className="re-small" onClick={()=>void showLead(lead)}>Open</button></td></tr>)}
      {!loading&&!visibleLeads.length&&<tr><td colSpan={7} className="re-empty">No enquiries match this view.</td></tr>}
     </tbody></table></div>
    </section>}

    {tab==="properties"&&<section className="re-panel">
     <div className="re-panel-head"><div><h2>Property inventory</h2><p>Matches are calculated only against current listings marked available.</p></div><button className="re-secondary" onClick={()=>setShowPropertyForm(v=>!v)}>＋ Add property</button></div>
     {showPropertyForm&&<form className="re-form" onSubmit={createProperty}>
      <div className="re-form-grid"><label>Reference<input required maxLength={100} value={propertyForm.reference} onChange={e=>setPropertyForm({...propertyForm,reference:e.target.value})}/></label><label>Listing title<input required maxLength={200} value={propertyForm.title} onChange={e=>setPropertyForm({...propertyForm,title:e.target.value})}/></label><label>Property type<select value={propertyForm.propertyType} onChange={e=>setPropertyForm({...propertyForm,propertyType:e.target.value})}>{["apartment","house","land","commercial","other"].map(x=><option key={x} value={x}>{label(x)}</option>)}</select></label><label>For<select value={propertyForm.transactionType} onChange={e=>setPropertyForm({...propertyForm,transactionType:e.target.value})}><option value="sale">Sale</option><option value="rent">Rent</option></select></label><label>Location<input required value={propertyForm.location} onChange={e=>setPropertyForm({...propertyForm,location:e.target.value})}/></label><label>Price<input required type="number" min="1" value={propertyForm.price} onChange={e=>setPropertyForm({...propertyForm,price:e.target.value})}/></label><label>Currency<input required maxLength={3} value={propertyForm.currency} onChange={e=>setPropertyForm({...propertyForm,currency:e.target.value.toUpperCase()})}/></label><label>Bedrooms<input type="number" min="0" value={propertyForm.bedrooms} onChange={e=>setPropertyForm({...propertyForm,bedrooms:e.target.value})}/></label><label>Listing URL<input type="url" value={propertyForm.listingUrl} onChange={e=>setPropertyForm({...propertyForm,listingUrl:e.target.value})}/></label></div>
      <div className="re-form-actions"><button className="re-primary" disabled={busy}>Save listing</button><button type="button" className="re-plain" onClick={()=>setShowPropertyForm(false)}>Cancel</button></div>
     </form>}
     <div className="re-table-wrap"><table className="re-table"><thead><tr><th>Listing</th><th>Type</th><th>Location</th><th>Price</th><th>Availability</th><th>Verified</th></tr></thead><tbody>
      {properties.map(p=><tr key={p.id}><td><strong>{p.title}</strong><small>{p.reference}</small></td><td>{label(p.property_type)} · {label(p.transaction_type)}</td><td>{p.location}</td><td>{money(Number(p.price),p.currency)}</td><td><select className="re-inline-select" disabled={busy} value={p.availability_status} onChange={e=>void updateProperty(p.id,e.target.value)}>{["available","pending","sold","rented","withdrawn"].map(x=><option key={x} value={x}>{label(x)}</option>)}</select></td><td>{p.last_verified_at?dateLabel(p.last_verified_at):"Unverified"}</td></tr>)}
      {!loading&&!properties.length&&<tr><td colSpan={6} className="re-empty">No listings yet. Add agency-owned inventory before matching leads.</td></tr>}
     </tbody></table></div>
    </section>}

    {tab==="followups"&&<section className="re-panel">
     <div className="re-panel-head"><div><h2>Follow-up sequence</h2><p>Long-term nurture for consenting email leads. Sending stops when a customer responds, withdraws consent, or an agent takes over.</p></div><span className="re-muted-tag">Email only</span></div>
     <div className="re-table-wrap"><table className="re-table"><thead><tr><th>Customer</th><th>Sequence</th><th>Due at</th><th>State</th><th>Attempts</th><th>Provider result</th></tr></thead><tbody>
      {followups.map(f=><tr key={f.id}><td><strong>{f.lead?.full_name??"Unknown lead"}</strong><small>{f.lead?.email??""}</small></td><td>{["Immediately","1 day","7 days","30 days","90 days"][f.sequence-1]??("Step "+f.sequence)}</td><td>{dateLabel(f.due_at)}</td><td><span className={"re-status "+f.status}>{label(f.status)}</span></td><td>{f.attempt_count}/{f.max_attempts}</td><td>{f.last_error_code??(f.sent_at?"Accepted "+dateLabel(f.sent_at):"—")}</td></tr>)}
      {!loading&&!followups.length&&<tr><td colSpan={6} className="re-empty">No follow-ups scheduled.</td></tr>}
     </tbody></table></div>
     <p className="re-footnote">Live delivery remains off until workspace Resend is tested and approved, the server feature switches are enabled, and a scheduler invokes the follow-up worker at least every five minutes. Provider acceptance is not the same as confirmed delivery.</p>
    </section>}

    {tab==="forms"&&<section className="re-panel">
     <div className="re-panel-head"><div><h2>Website enquiry forms</h2><p>Publish a secure intake endpoint for each agency website or campaign.</p></div><button className="re-secondary" onClick={()=>setShowIntakeForm(v=>!v)}>＋ Create form</button></div>
     {showIntakeForm&&<form className="re-form" onSubmit={createIntake}><label>Form name<input required maxLength={120} value={intakeName} onChange={e=>setIntakeName(e.target.value)}/></label><label>Allowed website origins <small>Exact origins separated by commas; include https:// and no page paths.</small><textarea required rows={3} value={origins} onChange={e=>setOrigins(e.target.value)}/></label><div className="re-form-actions"><button className="re-primary" disabled={busy}>Create secure form</button><button type="button" className="re-plain" onClick={()=>setShowIntakeForm(false)}>Cancel</button></div></form>}
     <div className="re-form-list">{forms.map(form=><article key={form.id}><div><strong>{form.name}</strong><small>Source: {form.default_source} · {form.allowed_origins.join(", ")}</small><small>Created {dateLabel(form.created_at)}</small></div><label className="re-toggle"><input type="checkbox" checked={form.enabled} onChange={e=>void updateForm(form,e.target.checked)}/> <span>{form.enabled?"Enabled":"Paused"}</span></label></article>)}{!loading&&!forms.length&&<p className="re-empty">No public forms configured.</p>}</div>
     <p className="re-footnote">Public keys are displayed once and stored only as SHA-256 hashes. Submissions require an Idempotency-Key, approved website origin, rate-limit capacity and explicit consent choice.</p>
     <div className="re-panel-head" style={{borderTop:"1px solid #2A3340",borderBottom:0,marginTop:8}}>
      <div><h2>Approved agency alert recipients</h2><p>Only inboxes added here by a workspace owner or admin receive lead qualification alerts.</p></div>
      <span className="re-muted-tag">{notificationRecipients.filter(r=>r.active).length} active</span>
     </div>
     {recipientError&&<div className="re-alert re-error" role="alert">{recipientError}</div>}
     <form className="re-form" onSubmit={approveRecipient}>
      <label>Agency alert inbox<input type="email" required maxLength={254} placeholder="leads@your-agency.com" value={newRecipientEmail} onChange={e=>setNewRecipientEmail(e.target.value)}/></label>
      <div className="re-form-actions"><button className="re-primary" disabled={busy}>Approve recipient</button></div>
     </form>
     <div className="re-form-list">{notificationRecipients.map(recipient=><article key={recipient.id}>
      <div><strong>{recipient.email}</strong><small>{recipient.active?"Approved "+dateLabel(recipient.approved_at):"Revoked "+(recipient.revoked_at?dateLabel(recipient.revoked_at):"")}</small></div>
      <button type="button" className="re-small" disabled={busy} onClick={()=>void changeRecipientApproval(recipient,!recipient.active)}>{recipient.active?"Revoke":"Re-approve"}</button>
     </article>)}{!recipientError&&!notificationRecipients.length&&<p className="re-empty">No agency alert recipients approved. Add the agency&apos;s designated inbox before enabling Resend alerts.</p>}</div>
     <p className="re-footnote">Rexnora no longer sends lead alerts automatically to every workspace owner/admin. Each agency recipient must be explicitly approved here. Revoke access to stop future alerts to that address.</p>
    </section>}

    {loading&&<p className="re-loading">Loading real-estate workspace…</p>}
    <footer className="re-footer">Rexnora Real Estate · Workspace-isolated lead and property records</footer>
   </div>
  </section>

  {showLeadForm&&<div className="re-modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setShowLeadForm(false)}}><form className="re-modal" onSubmit={createLead}>
   <div className="re-modal-head"><div><h2>Add enquiry</h2><p>Record what the customer actually supplied. Unknown details stay unknown.</p></div><button type="button" onClick={()=>setShowLeadForm(false)} aria-label="Close">×</button></div>
   <div className="re-form-grid"><label>Customer name<input required maxLength={160} value={leadForm.fullName} onChange={e=>setLeadForm({...leadForm,fullName:e.target.value})}/></label><label>Email<input type="email" value={leadForm.email} onChange={e=>setLeadForm({...leadForm,email:e.target.value})}/></label><label>Phone<input value={leadForm.phone} onChange={e=>setLeadForm({...leadForm,phone:e.target.value})}/></label><label>Intent<select value={leadForm.transactionType} onChange={e=>setLeadForm({...leadForm,transactionType:e.target.value})}><option value="buy">Buying</option><option value="rent">Renting</option><option value="invest">Investing</option><option value="sell">Selling</option><option value="unknown">Unknown</option></select></label><label>Property type<select value={leadForm.propertyType} onChange={e=>setLeadForm({...leadForm,propertyType:e.target.value})}>{["apartment","house","land","commercial","other","unknown"].map(x=><option key={x} value={x}>{label(x)}</option>)}</select></label><label>Preferred location<input value={leadForm.preferredLocation} onChange={e=>setLeadForm({...leadForm,preferredLocation:e.target.value})}/></label><label>Budget minimum<input type="number" min="0" value={leadForm.budgetMin} onChange={e=>setLeadForm({...leadForm,budgetMin:e.target.value})}/></label><label>Budget maximum<input type="number" min="0" value={leadForm.budgetMax} onChange={e=>setLeadForm({...leadForm,budgetMax:e.target.value})}/></label><label>Currency<input maxLength={3} value={leadForm.currency} onChange={e=>setLeadForm({...leadForm,currency:e.target.value.toUpperCase()})}/></label><label>Timeline<select value={leadForm.timeframe} onChange={e=>setLeadForm({...leadForm,timeframe:e.target.value})}>{["urgent","within_30_days","one_to_three_months","over_three_months","unknown"].map(x=><option key={x} value={x}>{label(x)}</option>)}</select></label><label>Financial readiness<select value={leadForm.readiness} onChange={e=>setLeadForm({...leadForm,readiness:e.target.value})}>{["cash_ready","pre_approved","financing_needed","researching","unknown"].map(x=><option key={x} value={x}>{label(x)}</option>)}</select></label><label>Preferred contact<select value={leadForm.contactPreference} onChange={e=>setLeadForm({...leadForm,contactPreference:e.target.value})}><option value="email">Email</option><option value="phone">Phone</option><option value="whatsapp">WhatsApp</option></select></label></div>
   <label className="re-consent"><input type="checkbox" checked={leadForm.consentToContact} onChange={e=>setLeadForm({...leadForm,consentToContact:e.target.checked})}/> I confirm the customer explicitly agreed to be contacted through the selected channel. WhatsApp requires explicit WhatsApp consent.</label><label className="re-consent" style={{display:"block"}}>Record the customer’s actual consent wording<textarea maxLength={1000} rows={3} required={leadForm.consentToContact} value={leadForm.consentText} onChange={e=>setLeadForm({...leadForm,consentText:e.target.value})} placeholder="Write the words the customer used. For WhatsApp, the wording must explicitly mention WhatsApp." /></label>
   <div className="re-form-actions"><button className="re-primary" disabled={busy}>Save enquiry</button><button className="re-plain" type="button" onClick={()=>setShowLeadForm(false)}>Cancel</button></div>
  </form></div>}

  {selected&&<div className="re-modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setSelected(null)}}><section className="re-modal re-detail">
   <div className="re-modal-head"><div><div className="dash-eyebrow">LEAD PROFILE</div><h2>{selected.lead.full_name}</h2><p>{selected.lead.email??"No email"} · {selected.lead.phone??"No phone"}</p></div><button onClick={()=>setSelected(null)} aria-label="Close">×</button></div>
   <div className="re-detail-grid"><div><span>Score</span><strong>{selected.lead.lead_score}/100 · {label(selected.lead.lead_temperature)}</strong></div><div><span>Intent</span><strong>{label(selected.lead.transaction_type)}</strong></div><div><span>Property</span><strong>{label(selected.lead.property_type)}</strong></div><div><span>Location</span><strong>{selected.lead.preferred_location??"Unknown"}</strong></div><div><span>Budget</span><strong>{money(selected.lead.budget_min,selected.lead.currency)} – {money(selected.lead.budget_max,selected.lead.currency)}</strong></div><div><span>Timeline</span><strong>{label(selected.lead.timeframe)}</strong></div></div>
   <div className="re-detail-controls"><label>Status<select disabled={busy} value={selected.lead.status} onChange={e=>void patchLead(selected.lead.id,{status:e.target.value})}>{["new","qualified","contacted","viewing_scheduled","negotiation","won","lost"].map(x=><option key={x} value={x}>{label(x)}</option>)}</select></label><label>Assigned agent<select disabled={busy} value={selected.lead.assigned_agent_id??""} onChange={e=>void patchLead(selected.lead.id,{assignedAgentId:e.target.value||null})}><option value="">Unassigned</option>{agents.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label></div>
   <div className="re-detail-actions"><button className="re-secondary" disabled={busy} onClick={()=>void patchLead(selected.lead.id,{customerResponded:true})}>Customer responded</button><button className="re-secondary" disabled={busy} onClick={()=>void patchLead(selected.lead.id,{agentTakesOver:true})}>Agent took over</button><button className="re-secondary" disabled={busy} onClick={()=>void patchLead(selected.lead.id,{consentToContact:false})}>Withdraw consent</button><button className="re-secondary" disabled={matching} onClick={()=>void findProperties(selected.lead.id)}>{matching?"Finding…":"Find properties"}</button></div>
   {propertyMatches.length>0&&<section className="re-match-results"><h3>Suggested property matches</h3>{propertyMatches.map(match=><article key={match.property.id}><div><strong>{match.property.title}</strong><small>{match.property.reference} · {label(match.property.property_type)} · {label(match.property.transaction_type)}</small><small>{match.property.location} · {money(Number(match.property.price),match.property.currency)}</small><small>{match.reasons.join(" ")}</small></div><b>{match.score}% match</b></article>)}</section>}
   {notice.includes("verified property matches")&&propertyMatches.length===0&&<p className="re-empty">No listings meet the matching rules. Check that the listing is available, recently verified, correctly priced, and in the same workspace.</p>}
   <div className="re-score-factors"><h3>Explainable lead score</h3>{(selected.lead.score_factors??[]).map(f=><div key={f.key}><span><strong>{f.label}</strong><small>{f.reason}</small></span><b>{f.points}/{f.maximum}</b></div>)}</div>
   <div className="re-activity"><h3>Recent activity</h3>{selected.activities.map(a=><div key={a.id}><strong>{label(a.activity_type)}</strong><small>{dateLabel(a.created_at)}</small></div>)}{!selected.activities.length&&<p>No activity recorded yet.</p>}</div>
  </section></div>}
 </main>;
}
