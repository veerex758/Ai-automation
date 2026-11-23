"use client";
import { useCallback,useEffect,useState } from "react";
import Link from "next/link";
import "./dashboards.css";

type Widget={id:string;type:"metric";title:string;metric:string};
type Dashboard={id:string;name:string;description:string;layout:"one_column"|"two_column"|"three_column";widgets:Widget[];updated_at:string};
type Metrics=Record<string,number>;
const catalog=[
 {metric:"workflow_count",title:"Workflows"},
 {metric:"execution_count",title:"Executions · 30 days"},
 {metric:"agent_count",title:"AI agents"},
 {metric:"success_rate",title:"Success rate · 30 days"},
 {metric:"failed_runs",title:"Failed runs · 30 days"},
 {metric:"integration_count",title:"Connected integrations"}
];
export default function DashboardsPage(){
 const [rows,setRows]=useState<Dashboard[]>([]);
 const [selected,setSelected]=useState<Dashboard|null>(null);
 const [metrics,setMetrics]=useState<Metrics>({});
 const [name,setName]=useState("Operations overview");
 const [description,setDescription]=useState("Live workspace activity and performance.");
 const [layout,setLayout]=useState<Dashboard["layout"]>("two_column");
 const [widgets,setWidgets]=useState<Widget[]>([]);
 const [busy,setBusy]=useState(false);
 const [loading,setLoading]=useState(true);
 const [notice,setNotice]=useState("");
 const [refreshed,setRefreshed]=useState("");
 const [creating,setCreating]=useState(false);
 const load=useCallback(async()=>{
  setLoading(true);
  try{
   const [list,metricResponse]=await Promise.all([fetch("/api/dashboards",{cache:"no-store"}),fetch("/api/dashboards/metrics",{cache:"no-store"})]);
   const a=await list.json(),b=await metricResponse.json();
   if(!list.ok)throw new Error(a.error||"Could not load dashboards.");
   if(!metricResponse.ok)throw new Error(b.error||"Could not load workspace metrics.");
   setRows(a.dashboards||[]);setMetrics(b.metrics||{});setRefreshed(b.refreshed_at||"");
   setSelected(current=>current?(a.dashboards||[]).find((d:Dashboard)=>d.id===current.id)||null:(a.dashboards||[])[0]||null);
  }catch(e){setNotice(e instanceof Error?e.message:"Could not load dashboard data.");}
  finally{setLoading(false);}
 },[]);
 useEffect(()=>{void load()},[load]);
 useEffect(()=>{
  if(selected&&!creating){setName(selected.name);setDescription(selected.description);setLayout(selected.layout);setWidgets(selected.widgets);}
 },[selected,creating]);
 const addWidget=(metric:string)=>{
  const item=catalog.find(x=>x.metric===metric);
  if(!item||widgets.some(w=>w.metric===metric)||widgets.length>=12)return;
  setWidgets(current=>[...current,{id:crypto.randomUUID().slice(0,16),type:"metric",title:item.title,metric}]);
 };
 const save=async()=>{
  setBusy(true);setNotice("");
  try{
   const payload={name,description,layout,widgets};
   const response=await fetch(selected&&!creating?"/api/dashboards/"+selected.id:"/api/dashboards",{method:selected&&!creating?"PATCH":"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
   const data=await response.json();if(!response.ok)throw new Error(data.error||"Could not save dashboard.");
   const saved=data.dashboard as Dashboard;
   setRows(current=>selected&&!creating?current.map(d=>d.id===saved.id?saved:d):[saved,...current]);
   setSelected(saved);setCreating(false);setNotice("Dashboard saved to this workspace.");
  }catch(e){setNotice(e instanceof Error?e.message:"Could not save dashboard.");}
  finally{setBusy(false);}
 };
 const startNew=()=>{setSelected(null);setName("New dashboard");setDescription("");setLayout("two_column");setWidgets([]);setCreating(true);};
 const removeWidget=(id:string)=>setWidgets(current=>current.filter(w=>w.id!==id));
 const deleteDashboard=async()=>{
  if(!selected||creating||!window.confirm("Delete this saved dashboard?"))return;
  setBusy(true);
  try{const r=await fetch("/api/dashboards/"+selected.id,{method:"DELETE"});const d=await r.json();if(!r.ok)throw new Error(d.error||"Delete failed.");setRows(current=>current.filter(x=>x.id!==selected.id));setSelected(null);setCreating(false);setWidgets([]);setNotice("Dashboard deleted.");}
  catch(e){setNotice(e instanceof Error?e.message:"Delete failed.");}
  finally{setBusy(false);}
 };
 const gridClass=layout.replace("_","-");
 return <main className="dashboards-shell">
  <header className="dashboards-header">
   <div><Link href="/dashboard">← Workspace</Link><p>WORKSPACE ANALYTICS</p><h1>Dashboard Builder</h1><span>Build saved views from live Aivanta workspace data.</span></div>
   <div className="dashboards-actions"><button onClick={()=>void load()} disabled={loading}>↻ Refresh data</button><button className="primary" onClick={startNew}>＋ New dashboard</button></div>
  </header>
  {notice&&<p className="dashboards-notice" role="status">{notice}</p>}
  <div className="dashboards-workspace">
   <aside className="dashboards-list"><div className="dashboards-list-title">SAVED DASHBOARDS</div>
    {rows.map(d=><button key={d.id} className={selected?.id===d.id&&!creating?"selected":""} onClick={()=>{setSelected(d);setCreating(false);}}><strong>{d.name}</strong><small>{d.widgets.length} widgets · Updated {new Date(d.updated_at).toLocaleDateString()}</small></button>)}
    {!rows.length&&!loading&&<p>No saved dashboards yet. Create your first one.</p>}
   </aside>
   <section className="dashboards-editor">
    {loading?<p>Loading workspace data…</p>:<>
     <div className="dashboards-fields">
      <label>Dashboard name<input value={name} onChange={e=>setName(e.target.value)} maxLength={100}/></label>
      <label>Description<input value={description} onChange={e=>setDescription(e.target.value)} maxLength={500}/></label>
      <label>Layout<select value={layout} onChange={e=>setLayout(e.target.value as Dashboard["layout"])}><option value="one_column">One column</option><option value="two_column">Two columns</option><option value="three_column">Three columns</option></select></label>
     </div>
     <div className="widget-toolbar"><strong>Widgets</strong><select defaultValue="" onChange={e=>{if(e.target.value)addWidget(e.target.value);e.target.value="";}}><option value="" disabled>＋ Add a live metric widget</option>{catalog.filter(c=>!widgets.some(w=>w.metric===c.metric)).map(c=><option key={c.metric} value={c.metric}>{c.title}</option>)}</select></div>
     <div className={"dashboard-widget-grid "+gridClass}>
      {widgets.map(w=><article className="dashboard-widget" key={w.id}><div><small>LIVE WORKSPACE METRIC</small><button onClick={()=>removeWidget(w.id)} aria-label={"Remove "+w.title}>×</button></div><h3>{w.title}</h3><strong>{w.metric==="success_rate"?(metrics[w.metric]||0)+"%":(metrics[w.metric]||0).toLocaleString()}</strong><span>Source: Aivanta workspace records</span></article>)}
      {!widgets.length&&<p className="widget-empty">Add a metric widget to begin building this dashboard.</p>}
     </div>
     <footer className="dashboards-footer"><span>{refreshed?"Data refreshed "+new Date(refreshed).toLocaleTimeString():"Metrics refresh on demand."}</span><div><button onClick={()=>void deleteDashboard()} disabled={!selected||creating||busy}>Delete</button><button className="primary" onClick={()=>void save()} disabled={busy||!name.trim()}>{busy?"Saving…":"Save dashboard"}</button></div></footer>
    </>}
   </section>
  </div>
 </main>;
}
