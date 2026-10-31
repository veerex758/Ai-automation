"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Provider = "openai" | "gemini" | "resend" | "slack" | "http";
type Integration = { provider: Provider; status: string; display_name: string; metadata: Record<string, unknown>; last_tested_at: string | null; last_test_status: string | null; updated_at: string };
type Definition = { provider: Provider; name: string; category: string; description: string; fields: { key: string; label: string; type?: string; placeholder: string; help: string }[]; note: string };
const definitions: Definition[] = [
 {provider:"openai",name:"OpenAI",category:"AI",description:"Connect an API key for supported AI workflow actions.",fields:[{key:"apiKey",label:"API key",type:"password",placeholder:"sk-…",help:"Stored encrypted. Never shown again after saving."}],note:"Connection test checks API authentication; it does not create a model response."},
 {provider:"gemini",name:"Google Gemini",category:"AI",description:"Connect Gemini models to AI-powered workflow steps.",fields:[{key:"apiKey",label:"API key",type:"password",placeholder:"Google AI API key",help:"Stored encrypted. Never shown again after saving."}],note:"Connection test checks API authentication; it does not run a workflow."},
 {provider:"resend",name:"Resend Email",category:"Communication",description:"Configure the sender identity used by guarded email actions.",fields:[{key:"apiKey",label:"Resend API key",type:"password",placeholder:"re_…",help:"Stored encrypted. Never shown again after saving."},{key:"fromEmail",label:"Verified sender address",placeholder:"Aivanta <hello@your-domain.com>",help:"Must be an identity accepted by your Resend account."}],note:"A connection check reads your Resend domains. It does not send an email. A verified sending domain may be required by Resend."},
 {provider:"slack",name:"Slack",category:"Communication",description:"Connect a Slack incoming webhook for approved workflow notifications.",fields:[{key:"webhookUrl",label:"Incoming webhook URL",type:"password",placeholder:"https://hooks.slack.com/services/…",help:"Keep this URL private. It is stored encrypted."}],note:"Saving does not send a message. The optional delivery test posts a clearly labelled test message to the selected Slack channel."},
 {provider:"http",name:"HTTP API",category:"Developer tools",description:"Connect an API host for allowlisted HTTPS requests.",fields:[{key:"host",label:"API hostname",placeholder:"api.example.com",help:"Hostname only; no path, protocol or local network address."},{key:"apiKey",label:"API key",type:"password",placeholder:"API credential",help:"Stored encrypted. Requests are limited by server-side host allowlists."}],note:"The connection check sends a GET request to the host root. The host must be included in AIVANTA_HTTP_ALLOWED_HOSTS."},
];
export default function IntegrationDirectory() {
 const [integrations,setIntegrations]=useState<Integration[]>([]);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const [search,setSearch]=useState("");
 const [category,setCategory]=useState("All");
 const [selected,setSelected]=useState<Provider|null>(null);
 const [values,setValues]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState(false);
 const [confirmSlack,setConfirmSlack]=useState(false);
 const refresh=useCallback(async()=>{
  setLoading(true);setError("");
  try{const response=await fetch("/api/workspace/integrations",{cache:"no-store"});const data=await response.json();if(!response.ok)throw new Error(data.error||"Could not load workspace integrations.");setIntegrations(data.integrations||[]);}
  catch(e){setError(e instanceof Error?e.message:"Could not load integrations.");}
  finally{setLoading(false);}
 },[]);
 useEffect(()=>{void refresh();},[refresh]);
 const categories=["All",...Array.from(new Set(definitions.map(item=>item.category)))];
 const visible=useMemo(()=>definitions.filter(item=>(category==="All"||item.category===category)&&`${item.name} ${item.description} ${item.category}`.toLowerCase().includes(search.toLowerCase())),[category,search]);
 const current=(provider:Provider)=>integrations.find(item=>item.provider===provider);
 const open=(provider:Provider)=>{setSelected(provider);setValues({});setConfirmSlack(false);setNotice("");};
 async function save(){
  if(!selected||busy)return;
  setBusy(true);setError("");setNotice("");
  try{
   const response=await fetch("/api/workspace/integrations",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({provider:selected,credentials:values})});
   const data=await response.json();if(!response.ok)throw new Error(data.error||"Could not save this connection.");
   setSelected(null);setValues({});setNotice(`${definitions.find(item=>item.provider===selected)?.name} credentials saved securely. Run a connection test to verify access.`);
   await refresh();
  }catch(e){setError(e instanceof Error?e.message:"Could not save this connection.");}
  finally{setBusy(false);}
 }
 async function test(provider:Provider){
  if(busy)return;
  if(provider==="slack"&&!confirmSlack){setError("Confirm the Slack delivery test before sending a message.");return;}
  setBusy(true);setError("");setNotice("");
  try{
   const response=await fetch("/api/workspace/integrations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({provider,confirmDeliveryTest:provider==="slack"&&confirmSlack})});
   const data=await response.json();if(!response.ok)throw new Error(data.error||"Connection test failed.");
   setNotice(data.note||"Connection test passed.");await refresh();
  }catch(e){setError(e instanceof Error?e.message:"Connection test failed.");await refresh();}
  finally{setBusy(false);}
 }
 async function disconnect(provider:Provider){
  if(busy)return;
  setBusy(true);setError("");setNotice("");
  try{const response=await fetch(`/api/workspace/integrations?provider=${provider}`,{method:"DELETE"});const data=await response.json();if(!response.ok)throw new Error(data.error||"Could not disconnect integration.");setNotice(`${definitions.find(item=>item.provider===provider)?.name} disconnected.`);await refresh();}
  catch(e){setError(e instanceof Error?e.message:"Could not disconnect integration.");}
  finally{setBusy(false);}
 }
 return <section className="integration-directory">
  <div className="integration-directory-tools">
   <label className="integration-search"><span aria-hidden="true">⌕</span><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search integrations" aria-label="Search integrations"/></label>
   <div className="integration-categories" aria-label="Filter integrations">{categories.map(item=><button key={item} type="button" className={category===item?"active":""} onClick={()=>setCategory(item)}>{item}</button>)}</div>
  </div>
  {error&&<div className="integration-feedback error" role="alert">{error}</div>}
  {notice&&<div className="integration-feedback success" role="status">{notice}</div>}
  {loading?<div className="section-empty-panel"><p>Loading workspace connection status…</p></div>:visible.length?<div className="section-cards-grid">{visible.map(item=>{
   const saved=current(item.provider);const connected=saved?.status==="connected";
   return <article className="section-info-card integration-directory-card" key={item.provider}>
    <div className={`workflow-app-icon ${item.provider}`}>{item.provider==="openai"?"◎":item.provider==="gemini"?"✦":item.provider==="resend"?"✉":item.provider==="slack"?"✳":"↗"}</div>
    <div className="section-card-title"><h3>{item.name}</h3><span className={`workflow-status ${connected?"status-active":"status-draft"}`}><i/>{connected?"Connected":saved?"Needs attention":"Not connected"}</span></div>
    <p>{item.description}</p>
    <small>{saved?.last_tested_at? `Last test: ${new Date(saved.last_tested_at).toLocaleString()} · ${saved.last_test_status||"unknown"}`: "No successful connection test recorded."}</small>
    <div className="integration-card-actions"><button className="section-card-link" type="button" onClick={()=>open(item.provider)}>{saved?"Update credentials":"Connect"} ↗</button>{saved&&<><button className="integration-test-button" type="button" disabled={busy} onClick={()=>void test(item.provider)}>Test connection</button><button className="integration-disconnect-button" type="button" disabled={busy} onClick={()=>void disconnect(item.provider)}>Disconnect</button></>}<Link className="integration-builder-link" href="/dashboard/builder">Configure in builder ↗</Link></div>
    {item.provider==="slack"&&saved&&<label className="integration-confirm"><input type="checkbox" checked={confirmSlack} onChange={event=>setConfirmSlack(event.target.checked)}/> I understand the test sends a message to Slack.</label>}
    {item.provider==="http"&&<small>Requests are restricted by the server&apos;s configured host allowlist.</small>}
   </article>;
  })}</div>:<div className="section-empty-panel"><h3>No matching integrations</h3><p>Try another search or category.</p><button className="subtle-button" type="button" onClick={()=>{setSearch("");setCategory("All");}}>Clear filters</button></div>}
  {selected&&(()=>{const definition=definitions.find(item=>item.provider===selected)!;return <div className="integration-modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)setSelected(null);}}><section className="integration-modal" role="dialog" aria-modal="true" aria-labelledby="integration-modal-title"><button className="integration-modal-close" type="button" onClick={()=>setSelected(null)} disabled={busy} aria-label="Close">×</button><span className="dash-eyebrow">SECURE CONNECTION</span><h2 id="integration-modal-title">Connect {definition.name}</h2><p>{definition.description}</p><form onSubmit={event=>{event.preventDefault();void save();}}>{definition.fields.map(field=><label className="integration-form-field" key={field.key}><span>{field.label}</span><input type={field.type||"text"} autoComplete="off" value={values[field.key]||""} onChange={event=>setValues(previous=>({...previous,[field.key]:event.target.value}))} placeholder={field.placeholder} required/><small>{field.help}</small></label>)}<div className="integration-security-note">{definition.note}</div><div className="integration-modal-actions"><button type="button" className="subtle-button" onClick={()=>setSelected(null)} disabled={busy}>Cancel</button><button type="submit" className="create-button" disabled={busy||definition.fields.some(field=>!values[field.key]?.trim())}>{busy?"Saving securely…":"Save credentials"}</button></div></form></section></div>;})()}
  <p className="integration-security-footnote">Credentials are submitted directly to Aivanta&apos;s authenticated server, encrypted before storage and never returned to the browser. Workspace owners and admins manage connections.</p>
 </section>;
}
