"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import "./dashboard.css";

type Workflow = { id: string; name: string; description: string; category: string; status: "Active" | "Draft" | "Paused" | "Archived"; runs: string; updated: string; icon: string; tone: string };

type WorkflowTemplate = {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  tone: string;
  time: string;
  definition: { version: 1; nodes: { id: string; type: "trigger" | "action" | "condition"; title: string; description: string; settings: Record<string, string> }[] };
};

const workflowTemplates: WorkflowTemplate[] = [
  {
    id: "comment-to-dm", name: "Comment to DM", category: "Social media", icon: "↗", tone: "violet", time: "3 steps",
    description: "Prepare a reply flow for people who comment a keyword on your post.",
    definition: { version: 1, nodes: [
      { id: "trigger-1", type: "trigger", title: "Receive a social comment", description: "Start when a comment event arrives from a connected platform.", settings: { event: "webhook" } },
      { id: "condition-1", type: "condition", title: "Check the keyword", description: "Continue only when the comment includes your chosen keyword.", settings: { field: "comment_text", operator: "contains", value: "guide" } },
      { id: "action-1", type: "action", title: "Prepare the DM reply", description: "Draft the direct message step; a social platform integration is still required to send it.", settings: { provider: "internal", operation: "create_task", recipient: "", message: "Thanks for commenting! Here is your guide: [add link]", url: "" } },
    ] },
  },
  {
    id: "lead-follow-up", name: "Lead follow-up", category: "Sales", icon: "◎", tone: "lime", time: "3 steps",
    description: "Create a repeatable follow-up checklist when a new lead comes in.",
    definition: { version: 1, nodes: [
      { id: "trigger-1", type: "trigger", title: "New lead received", description: "Start when your lead source sends a new lead event.", settings: { event: "webhook" } },
      { id: "condition-1", type: "condition", title: "Check follow-up status", description: "Only continue when the lead has not already been contacted.", settings: { field: "follow_up_status", operator: "equals", value: "pending" } },
      { id: "action-1", type: "action", title: "Prepare follow-up task", description: "Create a task for the sales team to contact the lead.", settings: { provider: "internal", operation: "create_task", recipient: "", message: "Follow up with {{lead_name}} about {{interest}}.", url: "" } },
    ] },
  },
  {
    id: "new-lead-alert", name: "New lead alert", category: "Sales", icon: "✉", tone: "blue", time: "2 steps",
    description: "Turn incoming lead events into an organized task for your team.",
    definition: { version: 1, nodes: [
      { id: "trigger-1", type: "trigger", title: "New lead arrives", description: "Listen for a new lead event from a connected source.", settings: { event: "webhook" } },
      { id: "action-1", type: "action", title: "Create team follow-up task", description: "Record the lead details and assign a next step.", settings: { provider: "internal", operation: "create_task", recipient: "", message: "Review new lead {{lead_name}} from {{source}}.", url: "" } },
    ] },
  },
  {
    id: "form-to-lead", name: "Form to lead", category: "Lead capture", icon: "▤", tone: "orange", time: "2 steps",
    description: "Start a lead-capture flow whenever a website form is submitted.",
    definition: { version: 1, nodes: [
      { id: "trigger-1", type: "trigger", title: "Form submitted", description: "A form provider or website webhook starts this workflow.", settings: { event: "webhook" } },
      { id: "action-1", type: "action", title: "Review submitted details", description: "Create a task to review and qualify the captured lead.", settings: { provider: "internal", operation: "create_task", recipient: "", message: "Qualify form submission from {{name}} ({{email}}).", url: "" } },
    ] },
  },
  {
    id: "support-triage", name: "Support ticket triage", category: "Customer support", icon: "◇", tone: "violet", time: "3 steps",
    description: "Flag urgent tickets and prepare a task for your support team.",
    definition: { version: 1, nodes: [
      { id: "trigger-1", type: "trigger", title: "Support request received", description: "Start when a ticket or support form arrives.", settings: { event: "webhook" } },
      { id: "condition-1", type: "condition", title: "Check urgency", description: "Identify requests marked as urgent.", settings: { field: "priority", operator: "equals", value: "urgent" } },
      { id: "action-1", type: "action", title: "Prepare support task", description: "Create a task to review and respond to the customer.", settings: { provider: "internal", operation: "create_task", recipient: "", message: "Urgent support request from {{customer_name}}: {{subject}}.", url: "" } },
    ] },
  },
  {
    id: "content-approval", name: "Content approval", category: "Content", icon: "✓", tone: "blue", time: "3 steps",
    description: "Route a submitted draft into a simple review checklist.",
    definition: { version: 1, nodes: [
      { id: "trigger-1", type: "trigger", title: "Draft submitted", description: "Start when a new content draft is submitted.", settings: { event: "webhook" } },
      { id: "condition-1", type: "condition", title: "Check review status", description: "Continue only while the draft is awaiting review.", settings: { field: "approval_status", operator: "equals", value: "pending" } },
      { id: "action-1", type: "action", title: "Create review task", description: "Create a checklist item for the reviewer.", settings: { provider: "internal", operation: "create_task", recipient: "", message: "Review content draft: {{content_title}}.", url: "" } },
    ] },
  },
];

const navItems = [
  { label: "Dashboard", icon: "▦", href: "/dashboard" },
  { label: "Workflows", icon: "↗", href: "/dashboard#workflows" },
  { label: "Integrations", icon: "⌘", href: "/dashboard/integrations" },
  { label: "AI Agents", icon: "✺", href: "/dashboard/ai-assistant" },
  { label: "Templates", icon: "▧", href: "/dashboard/templates" },
  { label: "Analytics", icon: "▥", href: "/dashboard/analytics" },
  { label: "Activity logs", icon: "◷", href: "/dashboard/activity" },
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
  const [setupTemplate, setSetupTemplate] = useState<WorkflowTemplate | null>(null);
  const [setupKeyword, setSetupKeyword] = useState("guide");
  const [setupGuideUrl, setSetupGuideUrl] = useState("");
  const [setupLeadSource, setSetupLeadSource] = useState("Website form");
  const [setupDelay, setSetupDelay] = useState("15_minutes");
  const [setupMessage, setSetupMessage] = useState("");

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

  function openCreateModal() {
    setEditingWorkflow(null);
    setNewName("");
    setWorkflowDescription("");
    setShowCreate(true);
    setOpenMenuId(null);
  }

  function openEditModal(workflow: Workflow) {
    setEditingWorkflow(workflow);
    setNewName(workflow.name);
    setWorkflowDescription(workflow.description || "");
    setShowCreate(true);
    setOpenMenuId(null);
  }

  async function saveWorkflow(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newName.trim();
    const description = workflowDescription.trim();
    const creatingWorkflow = !editingWorkflow;
    if (!name || savingWorkflow) return;

    setSavingWorkflow(true);
    setNotice("");
    try {
      const response = await fetch(
        editingWorkflow ? `/api/workflows/${editingWorkflow.id}` : "/api/workflows",
        {
          method: editingWorkflow ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, description }),
        },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save this workflow.");

      if (editingWorkflow) {
        setWorkflows((current) => current.map((item) => item.id === editingWorkflow.id ? result.workflow as Workflow : item));
        setNotice("Workflow changes saved.");
      } else {
        setWorkflows((current) => [result.workflow as Workflow, ...current]);
        setNotice("Draft saved to your Aivanta workspace.");
      }
      setNewName("");
      setWorkflowDescription("");
      setEditingWorkflow(null);
      setShowCreate(false);
      setFilter("All workflows");
      setSearch("");
      if (creatingWorkflow) router.push(`/dashboard/workflows/${(result.workflow as Workflow).id}`);
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Could not save this workflow.");
    } finally {
      setSavingWorkflow(false);
    }
  }

  function openTemplateSetup(template: WorkflowTemplate) {
    setSetupTemplate(template);
    setSetupKeyword("guide");
    setSetupGuideUrl("");
    setSetupLeadSource(template.id === "form-to-lead" ? "Website form" : "Website");
    setSetupDelay("15_minutes");
    setSetupMessage(template.id === "comment-to-dm" ? "Thanks for commenting! Here is your guide:" : template.id === "lead-follow-up" ? "Hi {{lead_name}}, just following up on your interest." : "Review the details and take the next step.");
    setNotice("");
  }

  async function createFromTemplate(template: WorkflowTemplate) {
    if (savingWorkflow) return;
    setSavingWorkflow(true);
    setNotice("");
    try {
      const response = await fetch("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: template.name, description: template.description }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not create this template.");
      const workflow = result.workflow as Workflow;
      const configuredDefinition = JSON.parse(JSON.stringify(template.definition)) as WorkflowTemplate["definition"];
      for (const node of configuredDefinition.nodes) {
        if (node.type === "condition" && template.id === "comment-to-dm") node.settings.value = setupKeyword.trim() || "guide";
        if (node.type === "trigger" && ["lead-follow-up", "new-lead-alert", "form-to-lead"].includes(template.id)) node.settings.source = setupLeadSource.trim() || "Not specified";
        if (node.type === "action") {
          if (template.id === "comment-to-dm") { node.settings.message = setupMessage.trim() || "Thanks for commenting! Here is your guide:"; node.settings.url = setupGuideUrl.trim(); }
          else if (template.id === "lead-follow-up") { node.settings.message = setupMessage.trim() || "Follow up with {{lead_name}} about {{interest}}."; node.settings.delay = setupDelay; }
          else if (template.id === "new-lead-alert" || template.id === "form-to-lead" || template.id === "support-triage" || template.id === "content-approval") node.settings.message = setupMessage.trim() || node.settings.message;
        }
      }
      const saveResponse = await fetch(`/api/workflows/${workflow.id}/definition`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ definition: configuredDefinition }),
      });
      const saveResult = await saveResponse.json();
      if (!saveResponse.ok) {
        // Avoid leaving an empty workflow behind when template configuration fails.
        const cleanupResponse = await fetch(`/api/workflows/${workflow.id}`, { method: "DELETE" });
        const cleanupNote = cleanupResponse.ok ? "" : " The empty workflow may still be in your dashboard.";
        throw new Error((saveResult.error || "The template steps could not be saved.") + cleanupNote);
      }
      setSetupTemplate(null);
      router.push(`/dashboard/workflows/${workflow.id}`);
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Could not create this template.");
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
    <main className="app-shell">
      <aside className="sidebar">
        <Link className="dash-brand" href="/" aria-label="Aivanta home"><span className="brand-mark"><img className="brand-logo" src="/aivanta-mark.svg" alt="" aria-hidden="true" /></span><span>Aivanta</span></Link>
        <div className="workspace-switch"><span className="workspace-avatar">A</span><span className="workspace-copy"><strong>{workspaceName}</strong><small>Free workspace</small></span><span className="switch-chevron">⌄</span></div>
        <div className="sidebar-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Workspace navigation">
          {navItems.map((item) => <Link key={item.label} href={item.href} className={(activeNav === item.label || (item.label === "Dashboard" && activeNav === "Overview")) ? "side-link selected" : "side-link"} onClick={() => setActiveNav(item.label)}><span className="side-icon">{item.icon}</span>{item.label}{["Integrations","AI Agents","Billing"].includes(item.label) && <span className="soon-tag">SETUP</span>}</Link>)}
        </nav>
        <div className="sidebar-label tools-label">BUILD</div>
        <button type="button" className="side-link" onClick={openCreateModal}><span className="side-icon">＋</span>Create workflow</button>
        <div className="sidebar-bottom"><div className="help-card"><span className="help-icon">✳</span><strong>New to automation?</strong><p>Start small. Build confidence with one workflow at a time.</p><Link href="/#how-it-works">Explore the basics ↗</Link></div><button className="profile-button"><span className="profile-avatar">R</span><span><strong>Workspace owner</strong><small>Starter account</small></span><span className="switch-chevron">•••</span></button></div>
      </aside>

      <section className="dashboard-main">
        <header className="dashboard-topbar"><div className="breadcrumbs">Workspace <span>/</span> <strong>{activeNav}</strong></div><div className="topbar-right"><span className="environment-badge"><i /> Development</span><button className="icon-button" aria-label="Notifications" onClick={() => setNotice("You're all caught up.")}>♧</button><span className="top-avatar">R</span></div></header>
        <div className="dashboard-content">
          <div className="welcome-row"><div><div className="dash-eyebrow"><span className="pulse" /> YOUR AUTOMATION SPACE</div><h1>Welcome back 👋</h1><p>Here’s what’s happening with your automation platform today.</p></div><button type="button" className="create-button" onClick={openCreateModal}><span>＋</span> Create Workflow</button></div>

          <section className="quick-start-section" aria-labelledby="quick-start-title">
            <div className="quick-start-heading"><div><div className="dash-eyebrow">SKIP THE BLANK CANVAS</div><h2 id="quick-start-title">Start with a template<span>.</span></h2><p>Choose an outcome. Customize the steps in your builder.</p></div><span className="template-count">6 starter flows</span></div>
            <div className="quick-start-grid">
              {workflowTemplates.map((template) => <article className="quick-template-card" key={template.id}>
                <div className={`quick-template-icon ${template.tone}`}>{template.icon}</div>
                <div className="quick-template-meta"><span>{template.category}</span><span>{template.time}</span></div>
                <h3>{template.name}</h3><p>{template.description}</p>
                <button type="button" onClick={() => openTemplateSetup(template)} disabled={savingWorkflow}>Set up template <span>↗</span></button>
              </article>)}
            </div>
            <p className="template-note"><span>ⓘ</span> Templates create editable drafts. Live social, email and other integrations are not connected yet.</p>
          </section>

          {notice && <div className="notice-bar" role="status"><span>ⓘ</span>{notice}<button onClick={() => setNotice("")} aria-label="Dismiss notice">×</button></div>}

          <div className="stats-grid">
            <article className="stat-card"><div className="stat-heading">Total workflows <span className="stat-symbol">↗</span></div><div className="stat-number">{workflows.length.toString().padStart(2, "0")}<span className="stat-caption"> in workspace</span></div><div className="stat-bottom"><span className="stat-dot dot-lime" />Your automation library</div></article>
            <article className="stat-card"><div className="stat-heading">Active workflows <span className="stat-symbol">◉</span></div><div className="stat-number">{workflows.filter((w) => w.status === "Active").length.toString().padStart(2, "0")}<span className="stat-caption"> enabled</span></div><div className="stat-bottom"><span className="stat-dot dot-green" />Ready when connected</div></article>
            <article className="stat-card"><div className="stat-heading">Successful runs <span className="stat-symbol">✓</span></div><div className="stat-number">—<span className="stat-caption"> no run data</span></div><div className="stat-bottom"><span className="stat-dot dot-violet" />Execution history not connected</div></article>
            <article className="stat-card"><div className="stat-heading">Failed runs <span className="stat-symbol">!</span></div><div className="stat-number">—<span className="stat-caption"> no run data</span></div><div className="stat-bottom"><span className="stat-dot dot-blue" />Execution history not connected</div></article>
          </div>

          <section className="dashboard-insights" aria-label="Workflow insights">
            <article className="performance-card"><div className="insight-heading"><div><strong>Workflow Performance</strong><small>Run activity over time</small></div><span>Last 7 days</span></div><div className="performance-empty"><div className="empty-chart-grid"><span>200</span><span>150</span><span>100</span><span>50</span><span>0</span></div><div className="performance-chart-line"><svg viewBox="0 0 520 145" role="img" aria-label="No execution data available yet"><path d="M0 118 H520 M0 84 H520 M0 50 H520 M0 16 H520" stroke="rgba(196,255,218,.1)" strokeWidth="1" fill="none"/><path d="M0 118 C42 105 52 111 80 91 S123 110 155 70 S198 100 235 65 S281 82 315 45 S370 77 405 38 S465 43 520 13" stroke="#b8ff58" strokeWidth="3" fill="none" strokeLinecap="round" strokeDasharray="5 7" opacity=".48"/></svg><div className="chart-empty-message">Execution data will appear here</div></div></div><div className="chart-date-labels"><span>7 days ago</span><span>5 days ago</span><span>3 days ago</span><span>Today</span></div></article>
            <article className="success-card"><strong>Success Rate</strong><div className="success-ring-dash"><span>—<small>No run data</small></span></div><p>Workflow runs will be summarized when execution history is available.</p></article>
          </section>

          <div className="section-title-row" id="workflows"><div><h2>Recent Workflows</h2><p>Manage your automations and check their current status.</p></div><button className="subtle-button" onClick={() => { setFilter("All workflows"); setSearch(""); }}>View all <span>↗</span></button></div>
          <div className="workflow-toolbar"><div className="filter-tabs">{["All workflows", "Active", "Draft", "Paused"].map((item) => <button key={item} className={filter === item ? "filter-tab active-filter" : "filter-tab"} onClick={() => setFilter(item)}>{item}{item === "All workflows" && <span>{workflows.length}</span>}</button>)}</div><label className="search-box"><span>⌕</span><input aria-label="Search workflows" placeholder="Search workflows..." value={search} onChange={(e) => setSearch(e.target.value)} /><kbd>⌘ K</kbd></label></div>

          <div className="workflow-table"><div className="table-header"><span>WORKFLOW</span><span>STATUS</span><span>RUNS</span><span>LAST UPDATED</span><span /></div>
            {loadingWorkflows && <div className="empty-state"><span>◷</span><strong>Loading your workflows…</strong><p>Connecting to your Aivanta workspace.</p></div>}
            {!loadingWorkflows && visibleWorkflows.map((workflow) => <article className="workflow-row" key={workflow.id}><div className="workflow-name-cell"><span className={"workflow-app-icon " + workflow.tone}>{workflow.icon}</span><span className="workflow-name-copy"><strong>{workflow.name}</strong><small>{workflow.description || "No description yet"}</small></span></div><div><span className={"workflow-status status-" + workflow.status.toLowerCase()}><i />{workflow.status}</span></div><span className="run-count">{workflow.runs}</span><span className="updated-time">{workflow.updated}</span><div className="workflow-actions"><button className="row-menu" aria-label={"Workflow actions for " + workflow.name} aria-expanded={openMenuId === workflow.id} onClick={() => setOpenMenuId((current) => current === workflow.id ? null : workflow.id)}>{deletingWorkflowId === workflow.id ? "…" : "•••"}</button>{openMenuId === workflow.id && <div className="workflow-action-menu"><Link href={`/dashboard/workflows/${workflow.id}`} className="builder-action" onClick={() => setOpenMenuId(null)}>Open builder <span>↗</span></Link><button type="button" onClick={() => openEditModal(workflow)}>Edit details</button><button type="button" className="danger-action" onClick={() => void deleteWorkflow(workflow)}>Delete workflow</button></div>}</div></article>)}
            {!loadingWorkflows && visibleWorkflows.length === 0 && <div className="empty-state"><span>⌕</span><strong>No workflows found</strong><p>Try another search or change your filters.</p><button onClick={() => { setFilter("All workflows"); setSearch(""); }}>Clear filters</button></div>}
          </div>
          <div className="dashboard-footnote"><span>ⓘ</span><p><strong>Your workspace is connected.</strong> Workflow drafts are saved to your Aivanta database. Live workflow execution and connected services are still in development.</p></div>
        </div>
      </section>

      {setupTemplate && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !savingWorkflow) setSetupTemplate(null); }}><section className="create-modal template-setup-modal" role="dialog" aria-modal="true" aria-labelledby="template-setup-title"><button className="modal-close" aria-label="Close setup" onClick={() => { if (!savingWorkflow) setSetupTemplate(null); }}>×</button><div className="modal-icon">{setupTemplate.icon}</div><div className="dash-eyebrow">STEP 1 · QUICK SETUP</div><h2 id="template-setup-title">Set up {setupTemplate.name}</h2><p>Answer a few simple questions. You can adjust everything later in the builder.</p><form onSubmit={(event) => { event.preventDefault(); void createFromTemplate(setupTemplate); }}>
        {setupTemplate.id === "comment-to-dm" && <><label htmlFor="setup-keyword">Keyword to watch for</label><input id="setup-keyword" maxLength={80} placeholder="guide" value={setupKeyword} onChange={(event) => setSetupKeyword(event.target.value)} required /><label htmlFor="setup-guide-url" className="description-label">Guide link <span>Optional</span></label><input id="setup-guide-url" type="url" placeholder="https://your-site.com/guide" value={setupGuideUrl} onChange={(event) => setSetupGuideUrl(event.target.value)} /><label htmlFor="setup-message" className="description-label">DM message</label><textarea id="setup-message" rows={3} maxLength={1000} value={setupMessage} onChange={(event) => setSetupMessage(event.target.value)} /></>}
        {["lead-follow-up", "new-lead-alert", "form-to-lead"].includes(setupTemplate.id) && <><label htmlFor="setup-source">Where do leads come from?</label><select id="setup-source" value={setupLeadSource} onChange={(event) => setSetupLeadSource(event.target.value)}><option>Website</option><option>Website form</option><option>Instagram</option><option>Facebook</option><option>WhatsApp</option><option>CRM</option><option>Manual entry</option><option>Other</option></select>{setupTemplate.id === "lead-follow-up" && <><label htmlFor="setup-delay" className="description-label">When should follow-up happen?</label><select id="setup-delay" value={setupDelay} onChange={(event) => setSetupDelay(event.target.value)}><option value="immediate">Immediately</option><option value="15_minutes">After 15 minutes</option><option value="1_hour">After 1 hour</option><option value="1_day">After 1 day</option></select></>}<label htmlFor="setup-message" className="description-label">Task message</label><textarea id="setup-message" rows={3} maxLength={1000} value={setupMessage} onChange={(event) => setSetupMessage(event.target.value)} /></>}
        {["support-triage", "content-approval"].includes(setupTemplate.id) && <><label htmlFor="setup-message">What should the team review?</label><textarea id="setup-message" rows={3} maxLength={1000} value={setupMessage} onChange={(event) => setSetupMessage(event.target.value)} /></>}
        <div className="modal-actions"><button type="button" className="cancel-button" onClick={() => setSetupTemplate(null)} disabled={savingWorkflow}>Cancel</button><button type="submit" className="create-button" disabled={savingWorkflow}>{savingWorkflow ? "Creating draft…" : "Create my draft"} <span>↗</span></button></div></form><small className="modal-disclaimer">This creates a saved draft only. It will not send DMs, contact leads, or run timers until integrations and execution are connected.</small></section></div>}

      {showCreate && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !savingWorkflow) { setShowCreate(false); setEditingWorkflow(null); } }}><section className="create-modal" role="dialog" aria-modal="true" aria-labelledby="create-title"><button className="modal-close" aria-label="Close dialog" onClick={() => { if (!savingWorkflow) { setShowCreate(false); setEditingWorkflow(null); } }}>×</button><div className="modal-icon">✳</div><div className="dash-eyebrow">{editingWorkflow ? "REFINE YOUR AUTOMATION" : "START WITH A CLEAR OUTCOME"}</div><h2 id="create-title">{editingWorkflow ? "Edit workflow" : "Create a workflow"}</h2><p>{editingWorkflow ? "Update the name and description for this workflow." : "Give your workflow a name and a clear description. You can configure its steps in a future release."}</p><form onSubmit={saveWorkflow}><label htmlFor="workflow-name">Workflow name</label><input id="workflow-name" autoFocus maxLength={80} placeholder="e.g. Welcome new customers" value={newName} onChange={(event) => setNewName(event.target.value)} required /><label htmlFor="workflow-description" className="description-label">Description <span>Optional</span></label><textarea id="workflow-description" maxLength={500} rows={3} placeholder="What should this workflow help you accomplish?" value={workflowDescription} onChange={(event) => setWorkflowDescription(event.target.value)} /><div className="modal-actions"><button type="button" className="cancel-button" onClick={() => { setShowCreate(false); setEditingWorkflow(null); }}>Cancel</button><button type="submit" className="create-button" disabled={savingWorkflow}>{savingWorkflow ? "Saving…" : editingWorkflow ? "Save changes" : "Create draft"} <span>↗</span></button></div></form><small className="modal-disclaimer">Changes are saved to your Aivanta workspace. Live execution is not connected yet.</small></section></div>}
    </main>
  );
}
