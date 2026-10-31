"use client";
import { useCallback, useEffect, useState } from "react";

type Provider = "openai" | "gemini" | "resend" | "slack" | "http";
type Item = { id: Provider; name: string; description: string; fields: string[]; hint: string };
type Connection = { provider: Provider; status: string; display_name: string; last_tested_at: string | null; last_test_status: string | null };
const items: Item[] = [
 {id:"openai",name:"OpenAI",description:"Use OpenAI models and actions.",fields:["apiKey"],hint:"Create an API key in your OpenAI account."},
 {id:"gemini",name:"Google Gemini",description:"Use Gemini models and actions.",fields:["apiKey"],hint:"Use a Google AI Studio API key."},
 {id:"resend",name:"Resend Email",description:"Send email through Resend.",fields:["apiKey","fromEmail"],hint:"A verified sender address/domain is required for live sending."},
 {id:"slack",name:"Slack",description:"Send notifications through an incoming webhook.",fields:["webhookUrl"],hint:"Create a Slack Incoming Webhook. Saving does not send a message."},
 {id:"http",name:"HTTP API",description:"Use an allowlisted external API host.",fields:["host","apiKey"],hint:"The hostname must also be in AIVANTA_HTTP_ALLOWED_HOSTS."}
];
const labels: Record<string,string> = {apiKey:"API key",fromEmail:"Verified sender email",webhookUrl:"Slack incoming webhook URL",host:"API hostname"};
export default function WorkspaceIntegrations() {
 const [connections,setConnections]=useState<Connection[]>([]);
 const [encryption,setEncryption]=useState<boolean|null>(null); const [selected,setSelected]=useState<Provider|null>(null);
 const [values,setValues]=useState<Record<string,string>>({}); const [busy,setBusy]=useState(""); const [message,setMessage]=useState(""); const [error,setError]=useState(""); const [loading,setLoading]=useState(true);
 const load=useCallback(async()=>{setLoading(true);setError("");try{
  const r=await fetch("/api/workspace/integrations",{cache:"no-store"});const b=await r.json();if(!r.ok)throw Error(b.error||"Could not load workspace integrations");
  setConnections(b.integrations||[]);setEncryption(Boolean(b.encryptionConfigured));
 }catch(e){setError(e instanceof Error?e.message:"Could not load integrations");}finally{setLoading(false);}},[]);
 useEffect(()=>{void load();},[load]);
 async function act(provider:Provider,method:"PUT"|"POST"|"DELETE"){
  if(busy)return;
  if(method==="POST"&&provider==="slack"&&!window.confirm("Send a real Aivanta test message to the connected Slack channel?"))return;
  setBusy(provider);setError("");setMessage("");
  try{const body=method==="PUT"?{provider,credentials:Object.fromEntries(items.find(x=>x.id===provider)!.fields.map(f=>[f,values[f]?.trim()||""]))}:{provider,...(method==="POST"&&provider==="slack"?{confirmDeliveryTest:true}:{})};
   const r=await fetch("/api/workspace/integrations"+(method==="DELETE"?"?provider="+provider:""),{method,headers:{"Content-Type":"application/json"},...(method==="DELETE"?{}:{body:JSON.stringify(body)})});
   const b=await r.json();if(!r.ok)throw Error(b.error||"Integration request failed");
   setMessage(method==="PUT"?"Credentials saved encrypted but not yet verified.":method==="POST"?(b.note||"Connection test passed."):"Integration disconnected.");
   if(method==="PUT"){setSelected(null);setValues({});}await load();
  }catch(e){setError(e instanceof Error?e.message:"Integration request failed");await load();}finally{setBusy("");}
 }
 return <div className="section-page-content">
  <div className="welcome-row"><div><div className="dash-eyebrow">WORKSPACE CONNECTIONS</div><h1>Integrations</h1><p>Connect an app once and reuse it across every workflow in this workspace.</p></div><button className="create-button" onClick={()=>void load()} disabled={loading}>Refresh status</button></div>
  {message&&<p role="status" style={{padding:12,background:"#eaf7ef",borderRadius:10,color:"#17663b"}}>{message}</p>}
  {error&&<p role="alert" style={{padding:12,background:"#fff0ef",borderRadius:10,color:"#a12a22"}}>{error}</p>}
  {encryption===false&&<p style={{padding:12,background:"#fff5df",borderRadius:10}}>Add the server-side Preview variable AIVANTA_CREDENTIALS_ENCRYPTION_KEY before connecting providers. Never use a NEXT_PUBLIC_ variable.</p>}

  <div className="section-cards-grid">
  {items.map(item=>{const c=connections.find(x=>x.provider===item.id);const ok=c?.status==="connected"&&c.last_test_status==="passed";return <article className="section-info-card" key={item.id}>
   <div className="section-card-title"><h3>{item.name}</h3><span className={"workflow-status "+(ok?"status-active":"status-draft")}><i/>{ok?"Connected":c?"Needs attention":"Not connected"}</span></div>
   <p>{item.description}</p>{c?.last_tested_at&&<small>Last test: {new Date(c.last_tested_at).toLocaleString()} · {c.last_test_status}</small>}
   {selected===item.id?<div style={{display:"grid",gap:10,marginTop:14}}>{item.fields.map(f=><label key={f} style={{display:"grid",gap:5,fontSize:12}}>{labels[f]}<input type={f==="apiKey"||f==="webhookUrl"?"password":"text"} autoComplete="off" value={values[f]||""} onChange={e=>setValues(v=>({...v,[f]:e.target.value}))} placeholder={f==="host"?"api.example.com":labels[f]}/></label>)}<small>{item.hint}</small><button className="create-button" disabled={!!busy||!item.fields.every(f=>values[f]?.trim())||encryption===false} onClick={()=>void act(item.id,"PUT")}>{busy===item.id?"Saving…":"Save credentials"}</button><button onClick={()=>setSelected(null)}>Cancel</button></div>:<div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:14}}>
    <button className="create-button" disabled={!!busy||encryption===false} onClick={()=>setSelected(item.id)}>{c?"Update credentials":"Connect"}</button>
    {c&&<><button onClick={()=>void act(item.id,"POST")} disabled={!!busy}>{busy===item.id?"Testing…":item.id==="slack"?"Send test message":"Test connection"}</button><button onClick={()=>void act(item.id,"DELETE")} disabled={!!busy}>Disconnect</button></>}
   </div>}
   {c&&!ok&&<small>Saved credentials are not considered connected until a test passes.</small>}
  </article>;})}
  </div>
  <div className="dashboard-footnote"><p><strong>Not yet available:</strong> Gmail and Google Sheets native OAuth connections. Their consent, callback, refresh-token and revocation flows still need implementation; they are not falsely marked connected.</p></div>
 </div>;
}
