"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import "./dashboard.css";

type Workflow = { id: string; name: string; description: string; category: string; status: "Active" | "Draft" | "Paused" | "Archived"; runs: string; updated: string; icon: string; tone: string };

const navItems = [
  { label: "Overview", icon: "⌂", href: "/dashboard" },
  { label: "Workflows", icon: "↗", href: "/dashboard#workflows" },
  { label: "Activity logs", icon: "◷", href: "/dashboard/activity" },
  { label: "Playbooks", icon: "◇", href: "/dashboard/playbooks/new" },
  { label: "AI agents", icon: "✺", href: "/dashboard/agents" },
  { label: "Templates", icon: "▧", href: "/dashboard/templates" },
  { label: "Integrations", icon: "⌘", href: "/dashboard/integrations" },
  { label: "Connected accounts", icon: "↗", href: "/dashboard/connections" },
  { label: "Real Estate", icon: "⌂", href: "/dashboard/real-estate" },
  { label: "Analytics", icon: "▥", href: "/dashboard/analytics" },
  { label: "Billing", icon: "◇", href: "/dashboard/billing" },
  { label: "Settings", icon: "⚙", href: "/dashboard/settings" },
];

export default function DashboardPage() {
  const router = useRouter();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [activeNav, setActiveNav] = useState("Overview");
  const [filter, setFilter] = useState("All workflows");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [workflowDescription, setWorkflowDescription] = useState("");
  const [editingWorkflow, setEditingWorkflow] = useState<Workflow | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [deletingWorkflowId, setDeletingWorkflowId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [workspaceName, setWorkspaceName] = useState("Your workspace");
  const [loadingWorkflows, setLoadingWorkflows] = useState(true);
  const [savingWorkflow, setSavingWorkflow] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadWorkflows() {
      try {
        const response = await fetch("/api/workflows", { cache: "no-store" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Could not load your workflows.");
        if (cancelled) return;
        setWorkspaceName(result.workspace?.name || "Your workspace");
        setWorkflows(Array.isArray(result.workflows) ? result.workflows : []);
      } catch (caught) {
        if (!cancelled) {
          setNotice(caught instanceof Error ? caught.message : "Could not load your workflows.");
        }
      } finally {
        if (!cancelled) setLoadingWorkflows(false);
      }
    }
    void loadWorkflows();
    return () => { cancelled = true; };
  }, []);

  const visibleWorkflows = useMemo(() => workflows.filter((item) => {
    const matchesSearch = (item.name + " " + item.description + " " + item.category).toLowerCase().includes(search.toLowerCase());
    const matchesFilter = filter === "All workflows" || item.status === filter;
    return matchesSearch && matchesFilter;
  }), [workflows, search, filter]);

  function openEditModal(workflow: Workflow) {
    setEditingWorkflow(workflow);
    setNewName(workflow.name);
    setWorkflowDescription(workflow.description || "");
    setShowCreate(true);
    setOpenMenuId(null);
  }

  async function saveWorkflow(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingWorkflow || savingWorkflow) return;
    const name = newName.trim();
    const description = workflowDescription.trim();
    if (!name) return;

    setSavingWorkflow(true);
    setNotice("");
    try {
      const response = await fetch(`/api/workflows/${editingWorkflow.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save this workflow.");

      setWorkflows((current) => current.map((item) =>
        item.id === editingWorkflow.id ? result.workflow as Workflow : item
      ));
      setNotice("Workflow details saved.");
      setNewName("");
      setWorkflowDescription("");
      setEditingWorkflow(null);
      setShowCreate(false);
      setFilter("All workflows");
      setSearch("");
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Could not save this workflow.");
    } finally {
      setSavingWorkflow(false);
    }
  }

  async function deleteWorkflow(workflow: Workflow) {
    const confirmed = window.confirm(`Delete "${workflow.name}"? This cannot be undone.`);
    if (!confirmed || deletingWorkflowId) return;

    setDeletingWorkflowId(workflow.id);
    setOpenMenuId(null);
    setNotice("");
    try {
      const response = await fetch(`/api/workflows/${workflow.id}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not delete this workflow.");
      setWorkflows((current) => current.filter((item) => item.id !== workflow.id));
      setNotice("Workflow deleted.");
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Could not delete this workflow.");
    } finally {
      setDeletingWorkflowId(null);
    }
  }


  return (
    <main className="app-shell dashboard-overview-page">
      <aside className="sidebar">
        <Link className="dash-brand" href="/" aria-label="Rexnora home"><span className="brand-mark">a</span><span>Rexnora<span className="brand-period">.</span></span></Link>
        <div className="workspace-switch"><span className="workspace-avatar">A</span><span className="workspace-copy"><strong>{workspaceName}</strong><small>Free workspace</small></span><span className="switch-chevron">⌄</span></div>
        <div className="sidebar-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Workspace navigation">
          {navItems.map((item) => <Link key={item.label} href={item.href} className={activeNav === item.label ? "side-link selected" : "side-link"}><span className="side-icon">{item.icon}</span>{item.label}</Link>)}
        </nav>
        <div className="sidebar-label tools-label">BUILD</div>
        <button type="button" className="side-link" onClick={() => router.push("/dashboard/playbooks/new")}><span className="side-icon">＋</span>Create Playbook</button>
        <div className="sidebar-bottom"><div className="help-card"><span className="help-icon">✳</span><strong>New to automation?</strong><p>Start small. Build confidence with one workflow at a time.</p><Link href="/#how-it-works">Explore the basics ↗</Link></div><button className="profile-button"><span className="profile-avatar">R</span><span><strong>Workspace owner</strong><small>Starter account</small></span><span className="switch-chevron">•••</span></button></div>
      </aside>

      <section className="dashboard-main">
        <header className="dashboard-topbar"><div className="breadcrumbs">Workspace <span>/</span> <strong>{activeNav}</strong></div><div className="topbar-right"><span className="environment-badge"><i /> Development</span><button className="icon-button" aria-label="Notifications" onClick={() => setNotice("You're all caught up.")}>♧</button><span className="top-avatar">R</span></div></header>
        <div className="dashboard-content">
          <div className="welcome-row"><div><div className="dash-eyebrow"><span className="pulse" /> YOUR AUTOMATION SPACE</div><h1>Good work starts here<span>.</span></h1><p>A clear view of your workflows, what’s running, and what’s next.</p></div><button type="button" className="create-button" onClick={openCreateModal}><span>＋</span> New Playbook</button></div>

          <section className="quick-start-section" aria-labelledby="quick-start-title">
            <div className="quick-start-heading">
              <div>
                <div className="dash-eyebrow">OUTCOME-FIRST AUTOMATION</div>
                <h2 id="quick-start-title">Start with a business result<span>.</span></h2>
                <p>Describe the work your agency wants handled. Review the proposed rules and permissions before saving.</p>
              </div>
              <Link className="create-button" href="/dashboard/playbooks/new">Create a Playbook <span>↗</span></Link>
            </div>
            <div className="quick-start-grid">
              <article className="quick-template-card">
                <div className="quick-template-icon blue">⌂</div>
                <div className="quick-template-meta"><span>Real estate</span><span>First commercial pilot</span></div>
                <h3>Qualify property enquiries</h3>
                <p>Capture an enquiry, qualify it with Gemini, apply deterministic rules and send an approved summary to the agency through Resend.</p>
                <Link href="/dashboard/playbooks/new">Configure this outcome <span>↗</span></Link>
              </article>
            </div>
            <p className="template-note"><span>ⓘ</span> New automation is created as a reviewed Playbook draft. Existing workflows remain available below for inspection and advanced editing.</p>
          </section>

          {notice && <div className="notice-bar" role="status"><span>ⓘ</span>{notice}<button onClick={() => setNotice("")} aria-label="Dismiss notice">×</button></div>}

          <div className="stats-grid">
            <article className="stat-card"><div className="stat-heading">Total workflows <span className="stat-symbol">↗</span></div><div className="stat-number">{workflows.length.toString().padStart(2, "0")}<span className="stat-caption"> in workspace</span></div><div className="stat-bottom"><span className="stat-dot dot-lime" />Your automation library</div></article>
            <article className="stat-card"><div className="stat-heading">Active workflows <span className="stat-symbol">◉</span></div><div className="stat-number">{workflows.filter((w) => w.status === "Active").length.toString().padStart(2, "0")}<span className="stat-caption"> enabled</span></div><div className="stat-bottom"><span className="stat-dot dot-green" />Ready when connected</div></article>
            <article className="stat-card"><div className="stat-heading">Tasks processed <span className="stat-symbol">⌁</span></div><div className="stat-number">2,392<span className="stat-caption"> sample data</span></div><div className="stat-bottom"><span className="stat-dot dot-violet" />Illustrative dashboard metric</div></article>
            <article className="stat-card"><div className="stat-heading">Time returned <span className="stat-symbol">◷</span></div><div className="stat-number">48.5<span className="stat-unit">h</span></div><div className="stat-bottom"><span className="stat-dot dot-blue" />Estimated sample data</div></article>
          </div>

          <div className="section-title-row" id="workflows"><div><h2>Your workflows</h2><p>Manage the building blocks of your automated work.</p></div><button className="subtle-button" onClick={() => { setFilter("All workflows"); setSearch(""); }}>View all <span>↗</span></button></div>
          <div className="workflow-toolbar"><div className="filter-tabs">{["All workflows", "Active", "Draft", "Paused"].map((item) => <button key={item} className={filter === item ? "filter-tab active-filter" : "filter-tab"} onClick={() => setFilter(item)}>{item}{item === "All workflows" && <span>{workflows.length}</span>}</button>)}</div><label className="search-box"><span>⌕</span><input aria-label="Search workflows" placeholder="Search workflows..." value={search} onChange={(e) => setSearch(e.target.value)} /><kbd>⌘ K</kbd></label></div>

          <div className="workflow-table"><div className="table-header"><span>WORKFLOW</span><span>STATUS</span><span>RUNS</span><span>LAST UPDATED</span><span /></div>
            {loadingWorkflows && <div className="empty-state"><span>◷</span><strong>Loading your workflows…</strong><p>Connecting to your Rexnora workspace.</p></div>}
            {!loadingWorkflows && visibleWorkflows.map((workflow) => <article className="workflow-row" key={workflow.id}><div className="workflow-name-cell"><span className={"workflow-app-icon " + workflow.tone}>{workflow.icon}</span><span className="workflow-name-copy"><strong>{workflow.name}</strong><small>{workflow.description || "No description yet"}</small></span></div><div><span className={"workflow-status status-" + workflow.status.toLowerCase()}><i />{workflow.status}</span></div><span className="run-count">{workflow.runs}</span><span className="updated-time">{workflow.updated}</span><div className="workflow-actions"><button className="row-menu" aria-label={"Workflow actions for " + workflow.name} aria-expanded={openMenuId === workflow.id} onClick={() => setOpenMenuId((current) => current === workflow.id ? null : workflow.id)}>{deletingWorkflowId === workflow.id ? "…" : "•••"}</button>{openMenuId === workflow.id && <div className="workflow-action-menu"><Link href={`/dashboard/workflows/${workflow.id}`} className="builder-action" onClick={() => setOpenMenuId(null)}>Open builder <span>↗</span></Link><button type="button" onClick={() => openEditModal(workflow)}>Edit details</button><button type="button" className="danger-action" onClick={() => void deleteWorkflow(workflow)}>Delete workflow</button></div>}</div></article>)}
            {!loadingWorkflows && visibleWorkflows.length === 0 && <div className="empty-state"><span>⌕</span><strong>No workflows found</strong><p>Try another search or change your filters.</p><button onClick={() => { setFilter("All workflows"); setSearch(""); }}>Clear filters</button></div>}
          </div>
          <div className="dashboard-footnote"><span>ⓘ</span><p><strong>Your workspace is connected.</strong> Workflow drafts are saved to your Rexnora database. New automation is created through Playbooks. Activation checks the saved version, provider connections, permissions and runtime safety gates.</p></div>
        </div>
      </section>

      {showCreate && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !savingWorkflow) { setShowCreate(false); setEditingWorkflow(null); } }}><section className="create-modal" role="dialog" aria-modal="true" aria-labelledby="create-title"><button className="modal-close" aria-label="Close dialog" onClick={() => { if (!savingWorkflow) { setShowCreate(false); setEditingWorkflow(null); } }}>×</button><div className="modal-icon">✳</div><div className="dash-eyebrow">EDIT WORKFLOW DETAILS</div><h2 id="create-title">Edit workflow</h2><p>"Update the name and description for this saved workflow."</p><form onSubmit={saveWorkflow}><label htmlFor="workflow-name">Workflow name</label><input id="workflow-name" autoFocus maxLength={80} placeholder="e.g. Welcome new customers" value={newName} onChange={(event) => setNewName(event.target.value)} required /><label htmlFor="workflow-description" className="description-label">Description <span>Optional</span></label><textarea id="workflow-description" maxLength={500} rows={3} placeholder="What should this workflow help you accomplish?" value={workflowDescription} onChange={(event) => setWorkflowDescription(event.target.value)} /><div className="modal-actions"><button type="button" className="cancel-button" onClick={() => { setShowCreate(false); setEditingWorkflow(null); }}>Cancel</button><button type="submit" className="create-button" disabled={savingWorkflow}>{savingWorkflow ? "Saving…" : "Save changes"} <span>↗</span></button></div></form><small className="modal-disclaimer">Changes are saved to your Rexnora workspace. Live execution is not connected yet.</small></section></div>}
    </main>
  );
}
