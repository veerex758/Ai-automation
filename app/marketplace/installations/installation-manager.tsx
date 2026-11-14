"use client";
import {useCallback,useEffect,useState} from "react";

type Connection={id:string;provider:string;label:string};
type Version={id:string;version:string;verification_status:string;changelog?:string};
type Detail={installation:{id:string;status:string;workflow_id:string|null;product_status:string;product_version_id:string;configuration:Record<string,unknown>};currentVersion:Version|null;latestVersion:Version|null;updateAvailable:boolean;rollbackVersions:Version[];requiredIntegrations:unknown[];connections:Connection[]};
export default function MarketplaceInstallationManager({installationId,productName,version,initialStatus}:{installationId:string;productName:string;version:string;initialStatus:string}){
 const [detail,setDetail]=useState<Detail|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState(""),[rollbackId,setRollbackId]=useState(""),[mappings,setMappings]=useState<Record<string,string>>({});
 const load=useCallback(async()=>{const r=await fetch("/api/marketplace/installations/"+installationId+"/lifecycle",{cache:"no-store"});const x=await r.json();if(!r.ok)throw Error(x.error??"Could not load installation.");setDetail(x as Detail);const current=x.installation?.configuration?.connections;setMappings(current&&typeof current==="object"?current as Record<string,string>:{});},[installationId]);
 useEffect(()=>{void load().catch(e=>setError(e instanceof Error?e.message:"Could not load installation."));},[load]);
 async function act(action:string,targetVersionId?:string){setBusy(true);setError("");setNotice("");try{const r=await fetch("/api/marketplace/installations/"+installationId+"/lifecycle",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,...(targetVersionId?{targetVersionId}:{})}),cache:"no-store"});const x=await r.json();if(!r.ok)throw Error(x.error??"Installation action failed.");setNotice(x.message??(action==="dry_run"?"Dry-run succeeded. The installation is ready for activation.":action==="activate"?"Workflow activated.":action==="pause"?"Workflow paused.":action==="uninstall"?"Installation removed.":"Installation updated."));await load();}catch(e){setError(e instanceof Error?e.message:"Installation action failed.");}finally{setBusy(false);}}
 async function saveConnections(){setBusy(true);setError("");setNotice("");try{const r=await fetch("/api/marketplace/installations/"+installationId+"/lifecycle",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"configure",configuration:{connections:mappings,options:{}}}),cache:"no-store"});const x=await r.json();if(!r.ok)throw Error(x.error??"Could not save connection mappings.");setNotice("Workspace connection mappings saved. Run a dry-run before activation.");await load();}catch(e){setError(e instanceof Error?e.message:"Could not save connection mappings.");}finally{setBusy(false);}}
 const providers=detail?.requiredIntegrations?.map(x=>typeof x==="string"?x:(x&&typeof x==="object"&&"provider" in x&&typeof x.provider==="string"?x.provider:"")).filter(Boolean) as string[]??[];
 const keys=[...new Set(providers.length?providers:(detail?.connections??[]).map(x=>x.provider))];
 return <article style={{border:"1px solid var(--marketplace-border,#ddd)",borderRadius:14,padding:18,margin:"16px 0",background:"var(--marketplace-card,#fff)"}}>
  <div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}><div><h2 style={{margin:"0 0 6px"}}>{productName}</h2><p style={{margin:0,opacity:.7}}>Installed {version} · {detail?.currentVersion?.version??version}</p></div><strong>{detail?.installation.status??initialStatus}</strong></div>
  {detail?.latestVersion&&detail.latestVersion.id!==detail.installation.product_version_id&&<p>Latest verified version: {detail.latestVersion.version}</p>}
  <h3>Workspace connections</h3>
  {keys.length?keys.map(provider=><label key={provider} style={{display:"flex",gap:12,alignItems:"center",margin:"8px 0"}}><span style={{minWidth:120}}>{provider}</span><select value={mappings[provider]??""} onChange={e=>setMappings(v=>({...v,[provider]:e.target.value}))} style={{flex:1,minWidth:0,padding:8}}><option value="">Choose a connected account</option>{(detail?.connections??[]).filter(x=>x.provider===provider).map(x=><option key={x.id} value={x.id}>{x.label}</option>)}</select></label>):<p>No connection mapping is required or declared by this product.</p>}
  <button type="button" disabled={busy} onClick={saveConnections} style={{marginTop:8}}>Save connection mappings</button>
  <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:16}}>
   {detail?.installation.status==="active"?<button disabled={busy} onClick={()=>act("pause")}>Pause</button>:null}
   {detail?.installation.status==="configuring"?<button disabled={busy} onClick={()=>act("dry_run")}>Run dry-test</button>:null}
   {detail?.installation.status==="ready"?<button disabled={busy} onClick={()=>act("activate")}>Activate</button>:null}
   {detail?.updateAvailable?<button disabled={busy||detail.installation.status==="active"} onClick={()=>act("update",detail.latestVersion?.id)}>Update to {detail.latestVersion?.version}</button>:null}
   {detail?.rollbackVersions?.length?<><select value={rollbackId} onChange={e=>setRollbackId(e.target.value)}><option value="">Choose rollback version</option>{detail.rollbackVersions.map(v=><option key={v.id} value={v.id}>{v.version}</option>)}</select><button disabled={busy||!rollbackId||detail.installation.status==="active"} onClick={()=>act("rollback",rollbackId)}>Rollback</button></>:null}
   {detail?.installation.status!=="removed"?<button disabled={busy||detail.installation.status==="active"} onClick={()=>act("uninstall")}>Uninstall</button>:null}
  </div>
  {detail?.installation.status==="active"&&detail.updateAvailable?<p>Pause the workflow before updating or rolling back.</p>:null}
  {notice&&<p role="status">{notice}</p>}{error&&<p role="alert" style={{color:"crimson"}}>{error}</p>}
 </article>;
}
