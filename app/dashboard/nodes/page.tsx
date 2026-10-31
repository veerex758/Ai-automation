"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import "../dashboard.css";

type NodeOperation = { id: string; name: string; description: string };
type NodeEntry = {
  id: string;
  name: string;
  icon: string;
  category: string;
  version: number;
  auth: { type: string; scopes?: string[]; credentialKey?: string };
  triggers: NodeOperation[];
  actions: NodeOperation[];
};
type CatalogResponse = { nodes?: NodeEntry[]; error?: string };

const categoryLabels: Record<string, string> = {
  triggers: "Triggers",
  ai: "AI",
  communication: "Communication",
  data: "Data",
  developer: "Developer tools",
};

export default function NodeLibraryPage() {
  const [nodes, setNodes] = useState<NodeEntry[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/workflows/actions", { cache: "no-store" });
        const result = (await response.json()) as CatalogResponse;
        if (!response.ok) throw new Error(result.error || "Could not load the node catalogue.");
        if (!cancelled) setNodes(Array.isArray(result.nodes) ? result.nodes : []);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not load the node catalogue.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  const categories = useMemo(() => ["All", ...Array.from(new Set(nodes.map((node) => node.category)))], [nodes]);
  const visible = useMemo(() => nodes.filter((node) => {
    const text = [node.name, node.id, node.category, ...node.triggers.map((item) => item.name), ...node.actions.map((item) => item.name)].join(" ").toLowerCase();
    return (category === "All" || node.category === category) && text.includes(search.toLowerCase());
  }), [nodes, category, search]);
  const operationCount = nodes.reduce((total, node) => total + node.triggers.length + node.actions.length, 0);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <Link className="dash-brand" href="/" aria-label="Aivanta home"><span className="brand-mark"><img className="brand-logo" src="/aivanta-mark.svg" alt="" /></span><span>Aivanta</span></Link>
        <div className="workspace-switch"><span className="workspace-avatar">A</span><span className="workspace-copy"><strong>Your workspace</strong><small>Workspace</small></span><span className="switch-chevron">⌄</span></div>
        <div className="sidebar-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Workspace navigation">
          <Link className="side-link" href="/dashboard"><span className="side-icon">▦</span>Dashboard</Link>
          <Link className="side-link" href="/dashboard#workflows"><span className="side-icon">↗</span>Workflows</Link>
          <Link className="side-link" href="/dashboard/integrations"><span className="side-icon">⌘</span>Integrations</Link>
          <Link className="side-link selected" href="/dashboard/nodes"><span className="side-icon">◇</span>Node library</Link>
          <Link className="side-link" href="/dashboard/ai-assistant"><span className="side-icon">✺</span>AI Agents</Link>
          <Link className="side-link" href="/dashboard/templates"><span className="side-icon">▧</span>Templates</Link>
          <Link className="side-link" href="/dashboard/analytics"><span className="side-icon">▥</span>Analytics</Link>
          <Link className="side-link" href="/dashboard/activity"><span className="side-icon">◷</span>Activity logs</Link>
          <Link className="side-link" href="/dashboard/billing"><span className="side-icon">◇</span>Billing</Link>
          <Link className="side-link" href="/dashboard/settings"><span className="side-icon">⚙</span>Settings</Link>
        </nav>
        <div className="sidebar-bottom"><div className="help-card"><span className="help-icon">✺</span><strong>Build with confidence</strong><p>Only reviewed nodes should run with workspace permissions.</p><Link href="/dashboard/builder">Open builder ↗</Link></div></div>
      </aside>
      <section className="dashboard-main">
        <header className="dashboard-topbar"><div className="breadcrumbs">Workspace <span>/</span><strong>Node library</strong></div><div className="topbar-right"><span className="environment-badge"><i/> Staging / Preview</span><Link className="subtle-button" href="/dashboard/builder">Open builder ↗</Link></div></header>
        <div className="dashboard-content section-page-content">
          <div className="welcome-row"><div><div className="dash-eyebrow"><span className="pulse"/> AIVANTA NODE ECOSYSTEM</div><h1>Node library</h1><p>Explore the trusted nodes already available to your workflows and see what each one can do.</p></div><span className="workflow-status status-active"><i/>First-party registry</span></div>
          <div className="node-library-summary">
            <article><span>Trusted nodes</span><strong>{loading ? "—" : nodes.length}</strong><small>Built into Aivanta</small></article>
            <article><span>Available operations</span><strong>{loading ? "—" : operationCount}</strong><small>Triggers and actions</small></article>
            <article><span>Community installs</span><strong>0</strong><small>Not enabled yet</small></article>
          </div>
          <section className="community-install-panel">
            <div className="community-install-mark">＋</div>
            <div><span className="dash-eyebrow">COMMUNITY NODE INSTALLATION</span><h2>Curated community nodes are next</h2><p>We&apos;re building publisher verification, package scanning, workspace approvals and isolated execution before enabling third-party installs. No unreviewed package can access your workspace.</p></div>
            <span className="workflow-status status-draft"><i/>In development</span>
          </section>
          <div className="section-title-row"><div><h2>Available in your builder</h2><p>These are the live first-party node definitions loaded from Aivanta&apos;s trusted registry.</p></div></div>
          <div className="node-library-tools">
            <label className="integration-search"><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search nodes and operations" aria-label="Search nodes and operations" /></label>
            <div className="integration-categories" aria-label="Filter node categories">{categories.map((item) => <button key={item} type="button" className={category === item ? "active" : ""} onClick={() => setCategory(item)}>{item === "All" ? "All" : categoryLabels[item] || item}</button>)}</div>
          </div>
          {error && <div className="integration-feedback error" role="alert">{error}</div>}
          {loading ? <div className="section-empty-panel"><p>Loading trusted node definitions…</p></div> : visible.length ? <div className="section-cards-grid node-library-grid">{visible.map((node) => <article className="section-info-card node-library-card" key={node.id}>
            <div className="node-library-card-top"><span className="node-library-icon">{node.icon}</span><span className="workflow-status status-active"><i/>Built in</span></div>
            <div className="quick-template-meta"><span>{categoryLabels[node.category] || node.category}</span><span>v{node.version}</span></div>
            <h3>{node.name}</h3><p>{node.id}</p>
            <div className="node-operation-counts"><span>{node.triggers.length} triggers</span><span>{node.actions.length} actions</span></div>
            <div className="node-operation-preview">{[...node.triggers, ...node.actions].slice(0, 3).map((operation) => <span key={operation.id}>{operation.name}</span>)}</div>
            <Link className="section-card-link" href="/dashboard/builder">Use in builder ↗</Link>
          </article>)}</div> : <div className="section-empty-panel"><h3>No matching nodes</h3><p>Try another search or category.</p><button className="subtle-button" type="button" onClick={() => { setSearch(""); setCategory("All"); }}>Clear filters</button></div>}
          <p className="integration-security-footnote">Node availability is read from the authenticated server registry. A node marked “Built in” is part of Aivanta&apos;s application; it is not a separately installed community package.</p>
        </div>
      </section>
    </main>
  );
}
