"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import "./assistant.css";

type GeneratedNode = { id: string; type: "trigger" | "action" | "condition"; title: string; description: string; settings: Record<string,string> };
type Draft = { version: 1; nodes: GeneratedNode[] };

export default function AIAssistantPage() {
  const router = useRouter();
  const [prompt,setPrompt] = useState("");
  const [draft,setDraft] = useState<Draft|null>(null);
  const [summary,setSummary] = useState("");
  const [error,setError] = useState("");
  const [loading,setLoading] = useState(false);
  const [savingDraft,setSavingDraft] = useState(false);
  const [pendingWorkflowId,setPendingWorkflowId] = useState<string|null>(null);
  async function generate(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(!prompt.trim()||loading)return;
    setLoading(true);setError("");setDraft(null);setSummary("");
    try {
      const response = await fetch("/api/ai/generate-workflow",{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({prompt:prompt.trim()})});
      const payload = await response.json() as {definition?:Draft;summary?:string;error?:string};
      if(!response.ok||!payload.definition)throw new Error(payload.error||"Aivanta couldn't create a draft. Please try again.");
      setDraft(payload.definition);setSummary(payload.summary||"AI-generated draft. Review every step before saving."); 
    } catch(caught) { setError(caught instanceof Error?caught.message:"Workflow generation failed safely."); }
    finally { setLoading(false); }
  }
  async function applyDraft() {
    if(!draft||savingDraft)return;
    setSavingDraft(true);setError("");
    try {
      let workflowId=pendingWorkflowId;
      if(!workflowId) {
        const createResponse=await fetch("/api/workflows",{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({name:"AI workflow draft",description:prompt.trim()})});
        const created=await createResponse.json() as {workflow?:{id:string};error?:string};
        if(!createResponse.ok||!created.workflow?.id)throw new Error(created.error||"Could not create a workspace draft.");
        workflowId=created.workflow.id;
        setPendingWorkflowId(workflowId);
      }
      const saveResponse=await fetch(`/api/workflows/${workflowId}/definition`,{method:"PATCH",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({definition:draft})});
      const saved=await saveResponse.json() as {success?:boolean;error?:string};
      if(!saveResponse.ok||!saved.success)throw new Error(saved.error||"The workflow record exists, but its steps could not be saved. Retry to finish saving.");
      router.push(`/dashboard/workflows/${workflowId}`);
    } catch(caught) {
      setError(caught instanceof Error?caught.message:"Could not save this draft. It has not been executed.");
    } finally { setSavingDraft(false); }
  }

  return <main className="app-shell ai-assistant-shell">
    <aside className="sidebar"><Link className="dash-brand" href="/" aria-label="Aivanta home"><span className="brand-mark"><img className="brand-logo" src="/aivanta-mark.svg" alt="" aria-hidden="true"/></span><span>Aivanta</span></Link><div className="workspace-switch"><span className="workspace-avatar">A</span><span className="workspace-copy"><strong>Your workspace</strong><small>AI workspace</small></span><span className="switch-chevron">⌄</span></div><div className="sidebar-label">WORKSPACE</div><nav className="side-nav" aria-label="Workspace navigation">{[["Dashboard","/dashboard","▦"],["Workflows","/dashboard#workflows","↗"],["Integrations","/dashboard/integrations","⌘"],["AI Agents","/dashboard/ai-assistant","✺"],["Templates","/dashboard/templates","▧"],["Analytics","/dashboard/analytics","▥"],["Activity logs","/dashboard/activity","◷"],["Billing","/dashboard/billing","◇"],["Settings","/dashboard/settings","⚙"]].map(([label,href,icon])=><Link key={label} href={href} className={label==="AI Agents"?"side-link selected":"side-link"}><span className="side-icon">{icon}</span>{label}</Link>)}</nav><div className="sidebar-bottom"><div className="help-card"><span className="help-icon">✺</span><strong>AI drafts, human control</strong><p>Review every generated step before saving or using a workflow.</p><Link href="/dashboard/builder">Open builder ↗</Link></div></div></aside>
    <section className="dashboard-main"><header className="dashboard-topbar"><div className="breadcrumbs">Workspace <span>/</span><strong>AI Assistant</strong></div><div className="topbar-right"><span className="environment-badge"><i/> Draft mode</span><span className="top-avatar">AI</span></div></header>
      <div className="dashboard-content ai-assistant-content"><div className="ai-assistant-intro"><div className="assistant-symbol">✺</div><div><div className="dash-eyebrow">AIVANTA AI ASSISTANT <span className="assistant-beta">BETA</span></div><h1>Describe it. We&apos;ll draft it.</h1><p>Explain the outcome you want in everyday language. Aivanta can propose a workflow draft for you to inspect and edit.</p></div></div>
        <div className="assistant-layout"><section className="assistant-chat-panel"><div className="assistant-chat-header"><div className="assistant-avatar">✺</div><div><strong>Aivanta Assistant</strong><small>Workflow drafting · no actions executed</small></div><span className="assistant-status">Ready</span></div><div className="assistant-message assistant-message-info"><span className="assistant-message-icon">✺</span><div><strong>Let&apos;s build your workflow</strong><p>For example: “When a new website form is submitted, save the lead details and prepare a welcome email for review.”</p></div></div>{draft&&<div className="assistant-generated"><div className="generated-title"><div><strong>Workflow draft generated</strong><small>{draft.nodes.length} steps · not saved · not executed</small></div><span className="draft-pill">Draft</span></div>{draft.nodes.map((node,index)=><div className="generated-node" key={node.id}><span className={"generated-node-icon node-"+node.type}>{node.type==="trigger"?"◎":node.type==="condition"?"◇":"↗"}</span><div><small>STEP {index+1} · {node.type.toUpperCase()}</small><strong>{node.title}</strong><p>{node.description}</p></div></div>)}<p className="generated-summary">{summary}</p><button type="button" className="assistant-apply-button" onClick={applyDraft} disabled={savingDraft}>{savingDraft?"Saving draft…":"Review draft in Builder"} <span>→</span></button></div>}{error&&<div className="assistant-error" role="alert"><strong>Couldn&apos;t generate the draft</strong><p>{error}</p></div>}<form className="assistant-prompt-form" onSubmit={generate}><label htmlFor="assistant-prompt">Describe the automation you want</label><textarea id="assistant-prompt" value={prompt} onChange={e=>setPrompt(e.target.value)} maxLength={2000} rows={4} placeholder="When a new lead fills out my website form, save their details and prepare a welcome email…" required/><div className="assistant-form-footer"><span>{prompt.length}/2000 · Draft only</span><button type="submit" disabled={loading||!prompt.trim()}>{loading?"Generating…":"Generate workflow"} <span>↗</span></button></div></form><p className="assistant-safety-note">Generated workflows are proposals only. Review all steps, placeholders, permissions and destinations before saving. Nothing runs from this page.</p></section><aside className="assistant-side-panel"><h2>How it works</h2><div><span>1</span><p><strong>Describe the outcome</strong><small>Use plain language; include the trigger and desired result.</small></p></div><div><span>2</span><p><strong>Review every step</strong><small>Check generated actions, placeholders and configuration.</small></p></div><div><span>3</span><p><strong>Edit in Builder</strong><small>Saving the proposal does not activate or execute it.</small></p></div><div className="assistant-tip"><strong>Good to know</strong><p>AI generation requires an authenticated session and configured server-side AI provider. If it isn&apos;t configured, the app will explain the issue.</p></div></aside></div>
      </div>
    </section>
  </main>;
}
