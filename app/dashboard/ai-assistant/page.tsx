"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import "./assistant.css";

type GeneratedNode = { id: string; type: "trigger" | "action" | "condition"; title: string; description: string; settings: Record<string, string> };
type Draft = { version: 1; nodes: GeneratedNode[] };
type RegistryDraftStep = { id: string; nodeId: string; operationId: string; kind: "trigger" | "action"; input: Record<string, unknown> };
type ChatMessage = { role: "user" | "assistant"; content: string };

export default function AIAssistantPage() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [registrySteps, setRegistrySteps] = useState<RegistryDraftStep[] | null>(null);
  const [summary, setSummary] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("Your workspace");

  useEffect(() => {
    let active = true;
    void fetch("/api/workflows", { cache: "no-store" })
      .then(async response => {
        if (!response.ok) return;
        const result = await response.json() as { workspace?: { name?: string } };
        if (active && typeof result.workspace?.name === "string") setWorkspaceName(result.workspace.name);
      })
      .catch(() => { /* Keep the generic workspace label if metadata is unavailable. */ });
    return () => { active = false; };
  }, []);

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const requestText = prompt.trim();
    if (!requestText || loading) return;
    const conversation = [...messages, { role: "user" as const, content: requestText }];
    const originalRequest = messages.find(message => message.role === "user")?.content;
    const currentOperations = (registrySteps || []).map(step => `${step.nodeId}.${step.operationId}`).join(", ");
    const providerPrompt = originalRequest && draft
      ? `Original request: ${originalRequest.slice(0, 650)}. Current registered steps: ${currentOperations.slice(0, 500)}. Refinement: ${requestText}. Return the complete revised workflow.`
      : requestText;
    if (providerPrompt.length > 2000) {
      setError("This refinement is too long. Shorten the request and try again.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/ai/generate-workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ prompt: providerPrompt }),
      });
      const payload = await response.json() as { definition?: Draft; registrySteps?: RegistryDraftStep[]; summary?: string; error?: string };
      if (!response.ok || !payload.definition || !Array.isArray(payload.registrySteps)) {
        throw new Error(payload.error || "Aivanta couldn't create a registry-validated draft. Please try again.");
      }
      setDraft(payload.definition);
      setRegistrySteps(payload.registrySteps);
      setSummary(payload.summary || "Registry-validated draft. Review every step before saving.");
      setMessages([...conversation, { role: "assistant", content: "I've updated the workflow draft. Review the steps below; nothing has been saved or executed." }]);
      setPrompt("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Workflow generation failed safely.");
    } finally {
      setLoading(false);
    }
  }

  async function applyDraft() {
    if (!draft || !registrySteps || savingDraft) return;
    setSavingDraft(true);
    setError("");
    try {
      const createResponse = await fetch("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({
          name: messages.find(message => message.role === "user")?.content.slice(0, 80) || "AI workflow draft",
          description: summary.slice(0, 500),
          status: "draft",
          definition: draft,
          registrySteps,
        }),
      });
      const created = await createResponse.json() as { workflow?: { id: string }; error?: string };
      if (!createResponse.ok || !created.workflow?.id) throw new Error(created.error || "Could not save the validated workspace draft.");
      const workflowId = created.workflow.id;
      router.push(`/dashboard/workflows/${workflowId}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save this draft. It has not been executed.");
    } finally {
      setSavingDraft(false);
    }
  }

  return <main className="app-shell ai-assistant-shell">
    <aside className="sidebar">
      <Link className="dash-brand" href="/" aria-label="Aivanta home"><span className="brand-mark"><img className="brand-logo" src="/aivanta-mark.svg" alt="" aria-hidden="true" /></span><span>Aivanta</span></Link>
      <div className="workspace-switch"><span className="workspace-avatar">A</span><span className="workspace-copy"><strong>{workspaceName}</strong><small>Workspace</small></span><span className="switch-chevron">⌄</span></div>
      <div className="sidebar-label">WORKSPACE</div>
      <nav className="side-nav" aria-label="Workspace navigation">{[["Dashboard", "/dashboard", "▦"], ["Workflows", "/dashboard#workflows", "↗"], ["Integrations", "/dashboard/integrations", "⌘"], ["AI Agents", "/dashboard/ai-assistant", "✺"], ["Templates", "/dashboard/templates", "▧"], ["Analytics", "/dashboard/analytics", "▥"], ["Activity logs", "/dashboard/activity", "◷"], ["Billing", "/dashboard/billing", "◇"], ["Settings", "/dashboard/settings", "⚙"]].map(([label, href, icon]) => <Link key={label} href={href} className={label === "AI Agents" ? "side-link selected" : "side-link"}><span className="side-icon">{icon}</span>{label}</Link>)}</nav>
      <div className="sidebar-bottom"><div className="help-card"><span className="help-icon">✺</span><strong>AI drafts, human control</strong><p>Review every generated step before saving or using a workflow.</p><Link href="/dashboard/builder">Open builder ↗</Link></div></div>
    </aside>
    <section className="dashboard-main">
      <header className="dashboard-topbar"><div className="breadcrumbs">Workspace <span>/</span><strong>AI Assistant</strong></div><div className="topbar-right"><span className="environment-badge"><i /> Draft mode</span><span className="top-avatar">AI</span></div></header>
      <div className="dashboard-content ai-assistant-content">
        <div className="ai-assistant-intro"><div className="assistant-symbol">✺</div><div><div className="dash-eyebrow">AIVANTA AI ASSISTANT <span className="assistant-beta">BETA</span></div><h1>Describe it. We&apos;ll build the draft.</h1><p>Describe an outcome, ask follow-up questions, and refine the workflow in conversation. Aivanta validates every operation against its live node registry.</p></div></div>
        <div className="assistant-layout">
          <section className="assistant-chat-panel">
            <div className="assistant-chat-header"><div className="assistant-avatar">✺</div><div><strong>Aivanta Assistant</strong><small>Conversational workflow drafting · no actions executed</small></div><span className="assistant-status">Ready</span></div>
            {messages.length === 0 && <div className="assistant-message assistant-message-info"><span className="assistant-message-icon">✺</span><div><strong>What would you like to automate?</strong><p>Example: “When a new website lead arrives, qualify it with AI, add it to Google Sheets and notify Slack.” You can refine the draft after the first response.</p></div></div>}
            {messages.map((message, index) => <div className={message.role === "user" ? "assistant-chat-turn assistant-chat-user" : "assistant-chat-turn assistant-chat-reply"} key={index}><strong>{message.role === "user" ? "You" : "Aivanta"}</strong><p>{message.content}</p></div>)}
            {loading && <div className="assistant-chat-turn assistant-chat-reply" role="status"><strong>Aivanta</strong><p>Building and validating your draft…</p></div>}
            {draft && <div className="assistant-generated">
              <div className="generated-title"><div><strong>Current workflow draft</strong><small>{registrySteps?.length || draft.nodes.length} registered steps · not saved · not executed</small></div><span className="draft-pill">Draft</span></div>
              {draft.nodes.map((node, index) => {
                const registered = registrySteps?.[index];
                return <div className="generated-node" key={node.id}><span className={"generated-node-icon node-" + node.type}>{node.type === "trigger" ? "◎" : node.type === "condition" ? "◇" : "↗"}</span><div><small>STEP {index + 1} · {node.type.toUpperCase()}</small><strong>{node.title}</strong><p>{node.description}</p>{registered && <p className="generated-operation">{registered.nodeId} / {registered.operationId}</p>}</div></div>;
              })}
              <p className="generated-summary">{summary}</p>
              <button type="button" className="assistant-apply-button" onClick={applyDraft} disabled={savingDraft}>{savingDraft ? "Saving draft…" : "Review validated draft in Builder"} <span>→</span></button>
            </div>}
            {error && <div className="assistant-error" role="alert"><strong>Couldn&apos;t update the draft</strong><p>{error}</p></div>}
            <form className="assistant-prompt-form" onSubmit={generate}>
              <label htmlFor="assistant-prompt">{draft ? "Ask Aivanta to refine this workflow" : "Describe the automation you want"}</label>
              <textarea id="assistant-prompt" value={prompt} onChange={event => setPrompt(event.target.value)} maxLength={2000} rows={4} placeholder={draft ? "Add a condition, change the notification, or use a different app…" : "When a new lead fills out my website form, qualify it and prepare a welcome email…"} required />
              <div className="assistant-form-footer"><span>{prompt.length}/2000 · {draft ? "Refinement creates a new draft version" : "Draft only"}</span><button type="submit" disabled={loading || !prompt.trim()}>{loading ? "Generating…" : draft ? "Refine workflow" : "Generate workflow"} <span>↗</span></button></div>
            </form>
            <p className="assistant-safety-note">Every refinement replaces the current unsaved proposal. Saving stores a draft only. It does not activate the workflow or execute external actions.</p>
          </section>
          <aside className="assistant-side-panel"><h2>How it works</h2><div><span>1</span><p><strong>Describe the outcome</strong><small>Explain the trigger, apps and result in plain language.</small></p></div><div><span>2</span><p><strong>Refine conversationally</strong><small>Ask Aivanta to add steps, change logic or clarify the draft.</small></p></div><div><span>3</span><p><strong>Review in Builder</strong><small>Only validated registry operations can be saved. Activation stays separate.</small></p></div><div className="assistant-tip"><strong>Safe by default</strong><p>Provider credentials are never requested in chat. Missing connections are handled during setup; generated drafts are never executed here.</p></div></aside>
        </div>
      </div>
    </section>
  </main>;
}
