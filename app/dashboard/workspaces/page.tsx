"use client";
import {useCallback,useEffect,useState} from "react";
import Link from "next/link";
import CustomRoles from "./custom-roles";
import "./workspaces.css";
type Workspace={id:string;name:string;owner_id:string;created_at:string};
type Member={user_id:string;email:string|null;role:string;joined_at:string};
type Invitation={id:string;email:string;role:string;status:string;expires_at:string};
export default function WorkspacesPage(){
 const [workspaces,setWorkspaces]=useState<Workspace[]>([]),[active,setActive]=useState(""),[currentUserId,setCurrentUserId]=useState("");
 const [members,setMembers]=useState<Member[]>([]),[invitations,setInvitations]=useState<Invitation[]>([]);
 const [name,setName]=useState(""),[email,setEmail]=useState(""),[role,setRole]=useState("member");
 const [inviteUrl,setInviteUrl]=useState(""),[notice,setNotice]=useState(""),[error,setError]=useState("");
 const [newOwner,setNewOwner]=useState("");
 const [allowInvites,setAllowInvites]=useState(true),[securityDirty,setSecurityDirty]=useState(false);
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
 const load=useCallback(async()=>{
  setLoading(true);setError("");
  try{const r=await fetch("/api/workspaces",{cache:"no-store"}),d=await r.json();if(!r.ok)throw new Error(d.error||"Could not load workspaces.");setWorkspaces(d.workspaces||[]);setActive(d.active_workspace_id||"");setCurrentUserId(d.user_id||"");}
  catch(e){setError(e instanceof Error?e.message:"Could not load workspaces.");}
  finally{setLoading(false);}
 },[]);
 const loadTeam=useCallback(async(id:string)=>{
  try{const [m,i,s]=await Promise.all([fetch("/api/workspaces/"+id+"/members",{cache:"no-store"}),fetch("/api/workspaces/"+id+"/invitations",{cache:"no-store"}),fetch("/api/workspaces/"+id+"/security",{cache:"no-store"})]);const md=await m.json(),idat=await i.json(),sd=await s.json();if(!m.ok)throw new Error(md.error||"Could not load members.");if(!s.ok)throw new Error(sd.error||"Could not load security settings.");setMembers(md.members||[]);setInvitations(idat.invitations||[]);setAllowInvites(sd.settings?.allow_member_invites!==false);setSecurityDirty(false);}
  catch(e){setError(e instanceof Error?e.message:"Could not load workspace team.");}
 },[]);
 useEffect(()=>{void load()},[load]);
 useEffect(()=>{if(active)void loadTeam(active)},[active,loadTeam]);
 async function createWorkspace(){
  setBusy(true);setError("");try{const r=await fetch("/api/workspaces",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name})}),d=await r.json();if(!r.ok)throw new Error(d.error||"Could not create workspace.");setName("");setNotice("Workspace created and selected.");await load();}
  catch(e){setError(e instanceof Error?e.message:"Could not create workspace.");}finally{setBusy(false);}
 }
 async function switchWorkspace(id:string){
  setBusy(true);setError("");try{const r=await fetch("/api/workspaces/"+id+"/switch",{method:"POST"}),d=await r.json();if(!r.ok)throw new Error(d.error||"Could not switch workspace.");setActive(id);setNotice("Active workspace changed. Your workspace pages now use this workspace.");}
  catch(e){setError(e instanceof Error?e.message:"Could not switch workspace.");}finally{setBusy(false);}
 }
 async function invite(){
  if(!active)return;setBusy(true);setError("");setInviteUrl("");
  try{const r=await fetch("/api/workspaces/"+active+"/invitations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,role})}),d=await r.json();if(!r.ok)throw new Error(d.error||"Could not create invitation.");setInviteUrl(d.invite_url);setEmail("");setNotice(d.email_sent?"Invitation email sent.":"Invitation created. Copy the link and share it with the invited person.");await loadTeam(active);}
  catch(e){setError(e instanceof Error?e.message:"Could not invite member.");}finally{setBusy(false);}
 }
 async function updateRole(user_id:string,nextRole:string){
  try{const r=await fetch("/api/workspaces/"+active+"/members",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({user_id,role:nextRole})}),d=await r.json();if(!r.ok)throw new Error(d.error||"Could not update role.");await loadTeam(active);setNotice("Member role updated.");}
  catch(e){setError(e instanceof Error?e.message:"Could not update role.");}
 }
 async function saveSecurity(){
  if(!active)return;setBusy(true);setError("");
  try{const r=await fetch("/api/workspaces/"+active+"/security",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({allow_member_invites:allowInvites})}),d=await r.json();if(!r.ok)throw new Error(d.error||"Could not update security policy.");setAllowInvites(d.settings.allow_member_invites);setSecurityDirty(false);setNotice("Workspace security policy updated.");}
  catch(e){setError(e instanceof Error?e.message:"Could not update security policy.");}finally{setBusy(false);}
 }
 async function transferOwnership(){
  if(!active||!newOwner||!window.confirm("Transfer workspace ownership? You will become an administrator."))return;
  setBusy(true);try{const r=await fetch("/api/workspaces/"+active+"/transfer",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({new_owner_id:newOwner})}),d=await r.json();if(!r.ok)throw new Error(d.error||"Transfer failed.");setNotice("Workspace ownership transferred.");setNewOwner("");await loadTeam(active);await load();}
  catch(e){setError(e instanceof Error?e.message:"Could not transfer ownership.");}finally{setBusy(false);}
 }
 async function revokeInvitation(id:string){
  try{const r=await fetch("/api/workspaces/"+active+"/invitations?invitation_id="+encodeURIComponent(id),{method:"DELETE"}),d=await r.json();if(!r.ok)throw new Error(d.error||"Could not revoke invitation.");await loadTeam(active);setNotice("Invitation revoked.");}
  catch(e){setError(e instanceof Error?e.message:"Could not revoke invitation.");}
 }
 async function removeMember(user_id:string){
  if(!window.confirm("Remove this member from the workspace?"))return;
  try{const r=await fetch("/api/workspaces/"+active+"/members?user_id="+encodeURIComponent(user_id),{method:"DELETE"}),d=await r.json();if(!r.ok)throw new Error(d.error||"Could not remove member.");await loadTeam(active);setNotice("Member removed.");}
  catch(e){setError(e instanceof Error?e.message:"Could not remove member.");}
 }
 return <main className="workspaces-shell">
  <header><Link href="/dashboard">← Workspace</Link><p>WORKSPACE ADMINISTRATION</p><h1>Workspaces & team</h1><span>Create workspaces, switch context and manage access.</span></header>
  {notice&&<p className="workspace-notice" role="status">{notice}</p>}{error&&<p className="workspace-error" role="alert">{error}</p>}
  <div className="workspace-admin-grid">
   <section className="workspace-admin-panel"><h2>Your workspaces</h2>{loading?<p>Loading workspaces…</p>:workspaces.map(w=><article className="workspace-choice" key={w.id}><div><strong>{w.name}</strong><small>{w.owner_id===members.find(m=>m.user_id===w.owner_id)?.user_id?"Owner":"Workspace"}</small></div>{active===w.id?<span className="workspace-current">Active</span>:<button onClick={()=>void switchWorkspace(w.id)} disabled={busy}>Switch</button>}</article>)}
    <div className="workspace-create"><label>New workspace name<input value={name} onChange={e=>setName(e.target.value)} maxLength={120} placeholder="e.g. Marketing team"/></label><button onClick={()=>void createWorkspace()} disabled={busy||!name.trim()}>Create workspace</button></div>
   </section>
   <section className="workspace-admin-panel"><h2>Invite a teammate</h2><p>Invitations expire after seven days. Administrator invitations are restricted to the workspace owner.</p><label>Email address<input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="teammate@company.com"/></label><label>Workspace role<select value={role} onChange={e=>setRole(e.target.value)}><option value="member">Member</option><option value="admin">Administrator</option></select></label><button onClick={()=>void invite()} disabled={busy||!active||!email.trim()}>Create invitation</button>
    {inviteUrl&&<div className="workspace-invite-link"><small>INVITATION LINK</small><input readOnly value={inviteUrl}/><button onClick={()=>{void navigator.clipboard.writeText(inviteUrl);setNotice("Invitation link copied.");}}>Copy link</button></div>}
   </section>
  </div>
  <section className="workspace-admin-panel workspace-team-panel"><h2>Members</h2><p>Roles are enforced by workspace APIs. The workspace owner cannot be removed or demoted.</p>
   {members.map(m=><article className="workspace-member" key={m.user_id}><div><strong>{m.email||m.user_id}</strong><small>Joined {new Date(m.joined_at).toLocaleDateString()}</small></div>{m.role==="owner"?<span className="workspace-current">Owner</span>:<><select value={m.role} onChange={e=>void updateRole(m.user_id,e.target.value)}><option value="member">Member</option><option value="admin">Administrator</option></select><button onClick={()=>void removeMember(m.user_id)}>Remove</button></>}</article>)}
   {!members.length&&<p>No members loaded. Select a workspace where you have owner/admin access.</p>}
  </section>
  {active&&<CustomRoles workspaceId={active} />}
  <section className="workspace-admin-panel workspace-team-panel"><h2>Pending invitations</h2>{invitations.map(i=><article className="workspace-member" key={i.id}><div><strong>{i.email}</strong><small>{i.role} · Expires {new Date(i.expires_at).toLocaleDateString()}</small></div><span className="workspace-current">{i.status}</span>{i.status==="pending"&&<button onClick={()=>void revokeInvitation(i.id)}>Revoke</button>}</article>)}{!invitations.length&&<p>No invitations for this workspace.</p>}</section>
  <section className="workspace-admin-panel workspace-team-panel"><h2>Security settings</h2><p>Control who can invite teammates. Live external actions continue to require the existing approval safeguards.</p><label className="workspace-security-toggle"><span><strong>Allow administrators to invite members</strong><small>When disabled, only the workspace owner can create invitations.</small></span><input type="checkbox" checked={allowInvites} disabled={workspaces.find(w=>w.id===active)?.owner_id!==currentUserId} onChange={e=>{setAllowInvites(e.target.checked);setSecurityDirty(true);}}/></label><div className="workspace-security-policy"><strong>Approval required for live external actions</strong><span>Always on · enforced by execution policy</span></div><button onClick={()=>void saveSecurity()} disabled={!securityDirty||busy||workspaces.find(w=>w.id===active)?.owner_id!==currentUserId}>Save security settings</button></section>
  {workspaces.find(w=>w.id===active)?.owner_id===currentUserId&&<section className="workspace-admin-panel workspace-team-panel"><h2>Transfer ownership</h2><p>Ownership transfer is immediate and audited. The previous owner becomes an administrator.</p><label>New workspace owner<select value={newOwner} onChange={e=>setNewOwner(e.target.value)}><option value="">Choose an existing member</option>{members.filter(m=>m.role!=="owner").map(m=><option key={m.user_id} value={m.user_id}>{m.email||m.user_id}</option>)}</select></label><button onClick={()=>void transferOwnership()} disabled={busy||!newOwner}>Transfer ownership</button></section>}
 </main>;
}
