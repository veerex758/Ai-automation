"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import "./agents.css";

type Agent = { id: string; name: string; description: string; instructions: string; model_provider: string; model_name: string; tool_ids: string[]; status: string; updated_at: string };
type Activity = { id: string; agent_id: string; event_type: string; details: Record<string, unknown>; created_at: string };
type Run = { id: string; status: string; input: string; output: string | null; error_code: string | null; created_at: string };
type AgentForm = { name: string; description: string; instructions: string; model_provider: "gemini" | "openai"; model_name: string; tool_ids: string[]; status: "draft" | "ready" | "paused" };
const blank: AgentForm = { name: "", description: "", instructions: "", model_provider: "gemini", model_name: "gemini-2.5-flash", tool_ids: [], status: "draft" };

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [selected, setSelected] = useState<Agent | null>(null);
  const [form, setForm] = useState<AgentForm>(blank);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [runs, setRuns] = useState<Run[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/agents", { cache: "no-store" });
      const payload = await response.json() as { agents?: Agent[]; activity?: Activity[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not load agents.");
      setAgents(payload.agents ?? []);
      setActivity(payload.activity ?? []);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Agent service unavailable.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function loadRuns(id: string) {
    try {
      const response = await fetch(`/api/agents/${id}/runs`, { cache: "no-store" });
      const payload = await response.json() as { runs?: Run[] };
      if (response.ok) setRuns(payload.runs ?? []);
    } catch { setRuns([]); }
  }

  function selectAgent(agent: Agent) {
    setSelected(agent); setCreating(false); setInput(""); setOutput("");
    setForm({ name: agent.name, description: agent.description, instructions: agent.instructions, model_provider: agent.model_provider as "gemini" | "openai", model_name: agent.model_name, tool_ids: agent.tool_ids ?? [], status: agent.status as AgentForm["status"] });
    void loadRuns(agent.id);
  }

  function startNew() {
    setSelected(null); setCreating(true); setForm(blank); setRuns([]); setInput(""); setOutput(""); setError(""); setNotice("");
  }

  async function save() {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(selected ? `/api/agents/${selected.id}` : "/api/agents", {
        method: selected ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
      });
      const payload = await response.json() as { agent?: Agent; error?: string };
      if (!response.ok || !payload.agent) throw new Error(payload.error || "Agent could not be saved.");
      setNotice(selected ? "Changes saved." : "Agent created.");
      await load();
      const id = payload.agent.id;
      const detail = await fetch(`/api/agents/${id}`, { cache: "no-store" }).then(r => r.json()) as { agent?: Agent };
      if (detail.agent) selectAgent(detail.agent);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Save failed."); }
    finally { setBusy(false); }
  }

  async function test() {
    if (!selected) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/agents/${selected.id}`, { method: "POST" });
      const payload = await response.json() as { valid?: boolean; error?: string };
      if (!response.ok) throw new Error(payload.error || "Configuration test failed.");
      setNotice(payload.valid ? "Configuration checks passed." : "Review the configuration checks before running.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Test failed."); }
    finally { setBusy(false); }
  }

  async function run() {
    if (!selected || !input.trim()) return;
    setBusy(true); setError(""); setOutput("");
    try {
      const response = await fetch(`/api/agents/${selected.id}/runs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input }) });
      const payload = await response.json() as { run?: { output?: string | null }; error?: string };
      if (!response.ok) throw new Error(payload.error || "Agent run failed.");
      setOutput(payload.run?.output ?? "The model returned an empty response.");
      await loadRuns(selected.id); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Agent run failed."); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!selected || !window.confirm(`Delete "${selected.name}"? This cannot be undone.`)) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/agents/${selected.id}`, { method: "DELETE" });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Agent could not be deleted.");
      setSelected(null); setCreating(false); setForm(blank); setRuns([]); setNotice("Agent deleted."); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Delete failed."); }
    finally { setBusy(false); }
  }

  const statusFilter = filter;
  const filteredAgents = agents.filter(agent => (agent.name + " " + agent.description).toLowerCase().includes(search.toLowerCase()) && (statusFilter === "all" || agent.status === statusFilter));

  return <main className="app-shell agents-shell">
    <aside className="sidebar">
      <Link className="dash-brand" href="/"><span className="brand-mark">✳</span><span>Aivanta</span></Link>
      <div className="sidebar-label">WORKSPACE</div>
      <nav className="side-nav" aria-label="Workspace navigation">
        {[["Dashboard","/dashboard"],["Workflows","/dashboard/builder"],["Integrations","/dashboard/integrations"],["AI Agents","/dashboard/agents"],["AI Assistant","/dashboard/ai-assistant"]].map(([label,href]) => <Link key={label} href={href} className={label === "AI Agents" ? "side-link selected" : "side-link"}>{label}</Link>)}
      </nav>
    </aside>
    <section className="dashboard-main">
      <header className="dashboard-topbar"><div className="breadcrumbs">Workspace / <strong>AI Agents</strong></div><span className="environment-badge">Model-only execution</span></header>
      <div className="dashboard-content agents-content">
        <div className="agents-heading"><div><div className="dash-eyebrow">WORKSPACE AI</div><h1>AI Agents</h1><p>Configure an agent, review its behavior, and run it with clear boundaries.</p></div><button type="button" onClick={startNew}>＋ Create agent</button></div>
        {error && <div className="agent-alert error" role="alert">{error}</div>}
        {notice && <div className="agent-alert" role="status">{notice}</div>}
        <div className="agent-metrics"><article><span>Total agents</span><strong>{agents.length}</strong></article><article><span>Ready</span><strong>{agents.filter(a => a.status === "ready").length}</strong></article><article><span>Drafts</span><strong>{agents.filter(a => a.status === "draft").length}</strong></article></div>
        <div className="agents-grid">
          <section className="agent-list-panel"><h2>Agent library <span>{agents.length}</span></h2>
            <div className="agent-list-tools"><input aria-label="Search agents" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)}/><select aria-label="Filter status" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All</option><option value="ready">Ready</option><option value="draft">Draft</option><option value="paused">Paused</option></select></div>
            {loading ? <p role="status">Loading agents…</p> : filteredAgents.length === 0 ? <div className="agent-empty">{agents.length ? "No agents match your filters." : "No agents yet. Create your first agent to get started."}</div> : filteredAgents.map(agent => <button type="button" className={selected?.id === agent.id ? "agent-row active" : "agent-row"} key={agent.id} onClick={() => selectAgent(agent)}><span className="agent-avatar">✺</span><span><strong>{agent.name}</strong><small>{agent.model_provider} · {agent.status}</small></span><span aria-hidden="true">›</span></button>)}
            {!loading && error && <button type="button" className="secondary" onClick={() => void load()}>Retry loading</button>}
          </section>
          <section className="agent-editor"><h2>{creating ? "New agent" : selected ? "Agent configuration" : "Choose an agent"}</h2>
            {creating || selected ? <>
              <label>Agent name<input value={form.name} maxLength={80} onChange={e => setForm({...form,name:e.target.value})} placeholder="Lead qualification"/></label>
              <label>Description<input value={form.description} maxLength={500} onChange={e => setForm({...form,description:e.target.value})} placeholder="What should this agent help with?"/></label>
              <label>Instructions<textarea rows={6} maxLength={12000} value={form.instructions} onChange={e => setForm({...form,instructions:e.target.value})} placeholder="Role, goals, constraints, tone, and when to ask a human."/></label>
              <div className="agent-form-row"><label>Provider<select value={form.model_provider} onChange={e => setForm({...form,model_provider:e.target.value as AgentForm["model_provider"],model_name:e.target.value === "openai" ? "gpt-4o-mini" : "gemini-2.5-flash"})}><option value="gemini">Gemini</option><option value="openai">OpenAI</option></select></label><label>Model<input value={form.model_name} onChange={e => setForm({...form,model_name:e.target.value})}/></label></div>
              <label>Lifecycle<select value={form.status} onChange={e => setForm({...form,status:e.target.value as AgentForm["status"]})}><option value="draft">Draft</option><option value="ready">Ready (model-only)</option><option value="paused">Paused</option></select></label>
              <label>Tool identifiers (reserved)<input value={form.tool_ids.join(", ")} onChange={e => setForm({...form,tool_ids:e.target.value.split(",").map(v=>v.trim()).filter(Boolean)})} placeholder="workflow.read, crm.search"/></label>
              <div className="agent-boundary"><strong>Execution boundary</strong><p>Agent runs call the selected language model only. Tool identifiers are saved as configuration; they are not executed and cannot trigger external actions.</p></div>
              <div className="agent-actions"><button type="button" disabled={busy} onClick={() => void save()}>{busy ? "Working…" : "Save agent"}</button>{selected && <><button type="button" className="secondary" disabled={busy} onClick={() => void test()}>Test configuration</button><button type="button" className="danger" disabled={busy} onClick={() => void remove()}>Delete</button></>}</div>
            </> : <p className="agent-empty">Select an agent from your library or create a new one.</p>}
          </section>
          {selected && <section className="agent-editor agent-run-panel"><h2>Run agent</h2><p>Safe model-only run · no tools or live actions.</p><label>Prompt<textarea rows={4} value={input} onChange={e => setInput(e.target.value)} placeholder="Give the agent a task or question…"/></label><button type="button" disabled={busy || !input.trim() || selected.status !== "ready"} onClick={() => void run()}>{busy ? "Running…" : "Run agent"}</button>{output && <pre className="agent-run-output">{output}</pre>}<h3>Recent runs</h3>{runs.length ? runs.map(run => <div className="activity-row" key={run.id}><span>{run.status} · {run.error_code ?? run.output?.slice(0,90) ?? run.input.slice(0,60)}</span><small>{new Date(run.created_at).toLocaleString()}</small></div>) : <p className="agent-empty">No runs yet.</p>}</section>}
        </div>
        <section className="agent-activity"><h2>Recent activity</h2>{activity.length ? activity.slice(0,15).map(item => <div className="activity-row" key={item.id}><span>{item.event_type.replace("agent.","").replaceAll("_"," ")}</span><small>{new Date(item.created_at).toLocaleString()}</small></div>) : <p>No agent activity recorded.</p>}</section>
        <p className="agent-runtime-note">Live tool execution and autonomous external actions are intentionally disabled in this agent runtime.</p>
      </div>
    </section>
  </main>;
}
