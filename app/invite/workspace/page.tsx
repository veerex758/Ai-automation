"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {useRouter} from "next/navigation";
export default function AcceptWorkspaceInvitation(){
 const router=useRouter();const [token,setToken]=useState("");
 useEffect(()=>{setToken(new URLSearchParams(window.location.search).get("token")||"");},[]);
 const [busy,setBusy]=useState(false),[error,setError]=useState("");
 async function accept(){
  setBusy(true);setError("");
  try{const r=await fetch("/api/workspaces/invitations/accept",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token})});const d=await r.json();if(!r.ok)throw new Error(d.error||"Could not accept invitation.");router.replace("/dashboard");}
  catch(e){setError(e instanceof Error?e.message:"Could not accept invitation.");}
  finally{setBusy(false);}
 }
 return <main style={{minHeight:"100vh",display:"grid",placeItems:"center",background:"#f7f8f5",padding:20,color:"#26352b"}}>
  <section style={{width:"min(100%,460px)",background:"#fff",border:"1px solid #e6ebe3",borderRadius:14,padding:30}}>
   <Link href="/dashboard" style={{fontSize:12,color:"#73816f",textDecoration:"none"}}>Aivanta</Link>
   <p style={{fontSize:9,letterSpacing:1.2,color:"#84917e",marginTop:28}}>WORKSPACE INVITATION</p>
   <h1 style={{fontFamily:"Manrope,sans-serif",fontSize:27,margin:"8px 0"}}>Join a workspace</h1>
   <p style={{fontSize:12,lineHeight:1.7,color:"#879287"}}>Accept the invitation using the account email address that received it. This link can only be used once and expires after seven days.</p>
   {error&&<p role="alert" style={{fontSize:11,color:"#9b4e39"}}>{error}</p>}
   <button onClick={()=>void accept()} disabled={busy||!token} style={{marginTop:14,padding:"12px 16px",background:"#26382d",color:"#fff",border:0,borderRadius:7,fontSize:11,cursor:"pointer"}}>{busy?"Accepting…":"Accept invitation"}</button>
  </section>
 </main>;
}
