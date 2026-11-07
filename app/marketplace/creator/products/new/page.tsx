"use client";
import Link from "next/link";
import {useEffect,useState,type FormEvent} from "react";
import "./new-product.css";
type Cat={id:string;name:string;slug:string};
type Check={passed:boolean;label:string};
type SubmitResponse={error?:string;checks?:Check[];message?:string};
const sample=JSON.stringify({definition:{version:1,nodes:[{id:"start",type:"trigger",title:"Manual start",description:"",settings:{event:"manual"}}]}},null,2);
export default function NewMarketplaceProduct(){
 const [cats,setCats]=useState<Cat[]>([]),[name,setName]=useState(""),[slug,setSlug]=useState(""),[summary,setSummary]=useState(""),[description,setDescription]=useState(""),[category,setCategory]=useState(""),[type,setType]=useState("workflow"),[pricing,setPricing]=useState("free"),[price,setPrice]=useState("0"),[artifact,setArtifact]=useState(sample),[busy,setBusy]=useState(false),[error,setError]=useState(""),[result,setResult]=useState("");
 useEffect(()=>{fetch("/api/marketplace/categories").then(r=>r.json()).then(d=>{setCats(d.categories??[]);setCategory(d.categories?.[0]?.id??"")}).catch(()=>{})},[]);
 async function submit(e:FormEvent){e.preventDefault();setBusy(true);setError("");setResult("");let parsed:unknown;try{parsed=JSON.parse(artifact)}catch{setError("Artifact JSON is invalid.");setBusy(false);return}
 try{const r=await fetch("/api/marketplace/products/submit",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,slug,summary,description,category_id:category,product_type:type,pricing_type:pricing,price_minor:pricing==="free"?0:Math.round(Number(price)*100),artifact:parsed,integrations:[],permissions:[]})});const d=await r.json() as SubmitResponse;if(!r.ok)throw Error(d.error+(d.checks?": "+d.checks.filter(x=>!x.passed).map(x=>x.label).join(", "):""));setResult(d.message??"Submitted")}catch(e){setError(e instanceof Error?e.message:"Submission failed")}finally{setBusy(false)}}
 return <main className="new-market-product"><header><Link href="/marketplace/creator">← Creator portal</Link><Link href="/marketplace">Marketplace ↗</Link></header><section><small>CREATOR STUDIO / SUBMISSION</small><h1>Submit a product</h1><p>Submissions are privately stored and checked by Aivanta. They are not published until verification and review are complete.</p>{result?<div className="nmp-success"><b>✓ Submitted for review</b><p>{result}</p><Link href="/marketplace/creator">Back to creator portal</Link></div>:<form onSubmit={submit}>
 <label>Product name<input required minLength={3} maxLength={140} value={name} onChange={e=>setName(e.target.value)}/></label>
 <label>Product URL slug<input required pattern="[a-z0-9-]{3,160}" value={slug} onChange={e=>setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,"-"))}/></label>
 <label>Short summary<textarea required minLength={10} maxLength={280} rows={2} value={summary} onChange={e=>setSummary(e.target.value)}/></label>
 <label>Description<textarea rows={5} value={description} onChange={e=>setDescription(e.target.value)}/></label>
 <div className="nmp-row"><label>Category<select required value={category} onChange={e=>setCategory(e.target.value)}>{cats.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Type<select value={type} onChange={e=>setType(e.target.value)}><option value="workflow">Workflow</option><option value="pack">Pack</option><option value="agent">AI agent</option></select></label></div>
 <div className="nmp-row"><label>Pricing<select value={pricing} onChange={e=>setPricing(e.target.value)}><option value="free">Free</option><option value="one_time">One-time</option><option value="recurring">Subscription</option></select></label>{pricing!=="free"&&<label>Price (USD)<input type="number" min="1" step="0.01" value={price} onChange={e=>setPrice(e.target.value)}/></label>}</div>
 <label>Workflow / product artifact (JSON)<textarea className="nmp-code" rows={12} value={artifact} onChange={e=>setArtifact(e.target.value)}/></label>
 {error&&<div className="nmp-error">{error}</div>}<button disabled={busy||!category}>{busy?"Submitting…":"Run checks & submit →"}</button><small className="nmp-foot">Aivanta performs workflow schema validation and secret scanning. Human review is mandatory before publication.</small></form>}</section></main>
}
