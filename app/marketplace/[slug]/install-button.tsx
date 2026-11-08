"use client";
import {useState} from "react";
import Link from "next/link";
type Result={error?:string;message?:string;workflow?:{id?:string;status?:string};updateAvailable?:boolean};
export default function MarketplaceInstallButton({productId}:{productId:string}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[installed,setInstalled]=useState<{workflowId?:string;message:string}|null>(null);
 async function install(){
  setBusy(true);setError("");
  try{
   const response=await fetch(`/api/marketplace/products/${productId}/install`,{method:"POST",headers:{"Content-Type":"application/json"},cache:"no-store"});
   const data=await response.json() as Result;
   if(!response.ok)throw new Error(data.error??"Installation failed.");
   setInstalled({workflowId:data.workflow?.id,message:data.message??"Installed as a draft."});
  }catch(e){setError(e instanceof Error?e.message:"Installation failed. Try again.");}
  finally{setBusy(false);}
 }
 if(installed)return <div className="mp-install-result" role="status"><strong>✓ Added to your workspace</strong><p>{installed.message}</p>{installed.workflowId&&<Link href={`/dashboard/workflows/${installed.workflowId}`}>Open draft workflow ↗</Link>}<button type="button" onClick={()=>setInstalled(null)}>Done</button></div>;
 return <div className="mp-install-action"><button type="button" onClick={install} disabled={busy}>{busy?"Installing…":"Install to workspace →"}</button>{error&&<p role="alert">{error}</p>}<small>Creates an inactive draft. No automation runs during installation.</small></div>;
}
