"use client";
import {useCallback,useEffect,useState} from "react";
import Link from "next/link";
import "./operations.css";
type Ops={alerts:string[];queue:Record<string,number>;workers:Array<{worker_id:string;status:string;health:string;last_seen_at:string;last_error_code:string|null}>;dead_letters:Array<{id:string;error_code:string;attempts:number;failed_at:string;replayed_at:string|null}>;performance:{runs_24h:number;average_latency_ms:number|null;failed_runs_24h:number};provider_failures:Record<string,number>;integrations:Array<{provider:string;status:string;last_test_status:string;updated_at:string}>;recent_jobs:Array<{id:string;status:string;attempts:number;worker_id:string|null;last_error_code:string|null;created_at:string}>};
export default function OperationsPage(){
 const [data,setData]=useState<Ops|null>(null);const [error,setError]=useState("");const [loading,setLoading]=useState(true);
 const load=useCallback(async()=>{setLoading(true);setError("");try{const r=await fetch("/api/operations",{cache:"no-store"});const d=await r.json();if(!r.ok)throw new Error(d.error||"Could not load operations.");setData(d as Ops);}catch(e){setError(e instanceof Error?e.message:"Could not load operations.");}finally{setLoading(false);}},[]);
 useEffect(()=>{void load()},[load]);
 return <main className="operations-shell">
  <header className="operations-header"><div><Link href="/dashboard">← Workspace</Link><p>PLATFORM CONTROL</p><h1>Operational monitoring</h1><span>Queue, worker, execution and integration health for this workspace.</span></div><button onClick={()=>void load()} disabled={loading}>↻ Refresh diagnostics</button></header>
  {error&&<p className="operations-error" role="alert">{error}</p>}
  {loading&&!data?<p>Loading operational diagnostics…</p>:data&&<>
   <section className="operations-stats">
    <article><small>QUEUED</small><strong>{data.queue.queued||0}</strong><span>Waiting to run</span></article>
    <article><small>RUNNING</small><strong>{data.queue.running||0}</strong><span>Leased jobs</span></article>
    <article><small>RETRY / WAIT</small><strong>{(data.queue.retry_wait||0)+(data.queue.waiting||0)}</strong><span>Scheduled recovery</span></article>
    <article><small>DEAD LETTERS</small><strong>{data.queue.dead_letter||0}</strong><span>Require investigation</span></article>
    <article><small>AVG LATENCY</small><strong>{data.performance.average_latency_ms===null?"—":data.performance.average_latency_ms+" ms"}</strong><span>Recorded runs · 24h</span></article>
    <article><small>FAILED RUNS</small><strong>{data.performance.failed_runs_24h}</strong><span>Last 24 hours</span></article>
   </section>
   <div className="operations-columns">
    <section className="operations-panel"><h2>Worker health</h2>{data.workers.length?data.workers.map(w=><div className="operations-row" key={w.worker_id}><div><strong>{w.worker_id}</strong><small>Last seen {new Date(w.last_seen_at).toLocaleString()}</small></div><span className={"ops-state "+w.health}>{w.health}</span></div>):<p>No worker heartbeat has been recorded yet. Worker health becomes observable after the updated worker runs.</p>}</section>
    <section className="operations-panel"><h2>Provider diagnostics</h2>{Object.keys(data.provider_failures).length?Object.entries(data.provider_failures).map(([provider,count])=><div className="operations-row" key={provider}><strong>{provider}</strong><span>{count} recent job errors</span></div>):<p>No provider-related job errors found in the recent job sample.</p>}{data.integrations.map(i=><div className="operations-row" key={i.provider}><div><strong>{i.provider}</strong><small>{i.last_test_status||"Not tested"}</small></div><span className="ops-state">{i.status}</span></div>)}</section>
   </div>
   <section className="operations-panel"><h2>Dead-letter queue</h2>{data.dead_letters.length?data.dead_letters.map(d=><div className="operations-row" key={d.id}><div><strong>{d.error_code}</strong><small>{new Date(d.failed_at).toLocaleString()} · {d.attempts} attempts</small></div><span>{d.replayed_at?"Replayed":"Needs review"}</span></div>):<p>No dead-letter jobs recorded for this workspace.</p>}</section>
   <section className="operations-panel"><h2>Recent execution jobs</h2><div className="operations-table"><div className="operations-table-head"><span>JOB</span><span>STATUS</span><span>ATTEMPTS</span><span>LAST ERROR</span></div>{data.recent_jobs.map(j=><div className="operations-table-row" key={j.id}><span>{j.id.slice(0,8)}</span><span>{j.status}</span><span>{j.attempts}</span><span>{j.last_error_code||"—"}</span></div>)}</div></section>
   <p className="operations-footnote">Diagnostics are read-only. Job replay, credential changes and provider actions are not triggered from this screen.</p>
  </>}
 </main>;
}
