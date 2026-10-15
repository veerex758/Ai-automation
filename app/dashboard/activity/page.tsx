"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import "./activity.css";

type ActivityRun = {
  id: string;
  workflowId: string;
  workflowName: string;
  mode: string;
  status: string;
  workflowVersion: number;
  createdAt: string;
  durationMs: number | null;
};

function formatDuration(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${Math.max(0, Math.round(value))} ms`;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export default function ActivityPage() {
  const [runs, setRuns] = useState<ActivityRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [workspaceName, setWorkspaceName] = useState("Your workspace");

  const loadActivity = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/activity", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load activity.");
      setRuns(Array.isArray(result.runs) ? result.runs : []);
      if (typeof result.workspace?.name === "string" && result.workspace.name.trim()) {
        setWorkspaceName(result.workspace.name.trim());
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load activity.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadActivity(); }, [loadActivity]);

  const visibleRuns = runs.filter((run) => {
    const matchesStatus = filter === "all" || run.status === filter;
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || `${run.workflowName} ${run.id} ${run.workflowId}`.toLowerCase().includes(query);
    return matchesStatus && matchesSearch;
  });
  const succeeded = runs.filter((run) => run.status === "succeeded").length;
  const failed = runs.filter((run) => run.status === "failed").length;

  return (
    <main className="app-shell activity-shell">
      <aside className="sidebar">
        <Link className="dash-brand" href="/" aria-label="Aivanta home"><span className="brand-mark">a</span><span>Aivanta<span className="brand-period">.</span></span></Link>
        <div className="workspace-switch"><span className="workspace-avatar">A</span><span className="workspace-copy"><strong>{workspaceName}</strong><small>Private workspace activity</small></span></div>
        <div className="sidebar-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Workspace navigation">
          <Link className="side-link" href="/dashboard"><span className="side-icon">⌂</span>Overview</Link>
          <Link className="side-link" href="/dashboard"><span className="side-icon">↗</span>Workflows</Link>
          <Link className="side-link selected" href="/dashboard/activity" aria-current="page"><span className="side-icon">◷</span>Activity logs</Link>
        </nav>
        <div className="sidebar-bottom"><div className="help-card"><div className="help-icon">✳</div><strong>Need a hand?</strong><p>Review each run&apos;s mode, status, and workflow version to understand what happened.</p><Link href="/dashboard">Back to dashboard ↗</Link></div></div>
      </aside>
      <section className="dashboard-main">
        <header className="dashboard-topbar"><div className="breadcrumbs"><Link href="/dashboard">Workspace</Link><span>›</span><strong>Activity logs</strong></div><div className="topbar-right"><span className="environment-badge"><i />Workspace scoped</span><button type="button" className="subtle-button" onClick={() => void loadActivity()} disabled={loading}>{loading ? "Refreshing…" : "Refresh ↻"}</button></div></header>
        <div className="dashboard-content activity-content">
          <div className="welcome-row"><div><div className="dash-eyebrow"><span className="pulse" />RUN HISTORY</div><h1>Activity <span>logs.</span></h1><p>A clear, private record of workflow test runs in your workspace.</p></div></div>
          <div className="stats-grid activity-stats">
            <article className="stat-card"><div className="stat-heading">Recent runs</div><div className="stat-number">{runs.length}</div><div className="stat-bottom">Latest {runs.length ? "up to 50" : "run history"}</div></article>
            <article className="stat-card"><div className="stat-heading">Succeeded</div><div className="stat-number">{succeeded}</div><div className="stat-bottom"><span className="stat-dot dot-green" />Successful records</div></article>
            <article className="stat-card"><div className="stat-heading">Failed</div><div className="stat-number">{failed}</div><div className="stat-bottom"><span className="stat-dot dot-violet" />Failed records</div></article>
          </div>
          {error && <div className="activity-error" role="alert"><strong>Activity could not be loaded.</strong><p>{error}</p><button className="subtle-button" onClick={() => void loadActivity()}>Try again</button></div>}
          <div className="section-title-row"><div><h2>Recent workflow runs</h2><p>Only run metadata is shown here; secrets and input payloads are never displayed.</p></div><div className="activity-controls"><label className="activity-search"><span className="visually-hidden">Search activity</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search workflows or run ID" /></label><div className="activity-filters" role="group" aria-label="Filter activity">{[["all","All"],["succeeded","Succeeded"],["failed","Failed"]].map(([value,label]) => <button key={value} type="button" aria-pressed={filter === value} className={filter === value ? "activity-filter active" : "activity-filter"} onClick={() => setFilter(value)}>{label}</button>)}</div></div></div>
          <div className="activity-table" aria-live="polite">
            <div className="activity-table-head"><span>WORKFLOW</span><span>MODE</span><span>STATUS</span><span>VERSION</span><span>DURATION</span><span>WHEN</span><span /></div>
            {loading && <div className="activity-empty"><strong>Loading activity…</strong><p>Retrieving recent runs for your workspace.</p></div>}
            {!loading && !error && visibleRuns.map((run) => <article className="activity-row" key={run.id}>
              <div className="activity-workflow"><strong>{run.workflowName}</strong><small>Run {run.id.slice(0, 8)}</small></div>
              <span className="activity-mode">{run.mode === "dry_run" ? "Dry run" : run.mode}</span>
              <span className={"activity-status " + (run.status === "succeeded" ? "success" : run.status === "failed" ? "failure" : "neutral")}><i />{run.status}</span>
              <span>v{run.workflowVersion}</span><span>{formatDuration(run.durationMs)}</span><time dateTime={run.createdAt}>{formatDate(run.createdAt)}</time>
              <Link className="activity-open" href={`/dashboard/activity/${run.id}`} aria-label={`View ${run.workflowName} run details`}>Details ↗</Link>
            </article>)}
            {!loading && !error && visibleRuns.length === 0 && <div className="activity-empty"><strong>{runs.length ? "No runs match this filter" : "No workflow runs yet"}</strong><p>{runs.length ? "Choose another status to see more activity." : "Run a workflow test from the builder and its result will appear here."}</p>{!runs.length && <Link className="create-button" href="/dashboard">Open dashboard <span>↗</span></Link>}</div>}
          </div>
          <p className="activity-footnote">Activity is workspace-scoped and read-only. Workflow execution remains subject to the safety gates configured for Aivanta.</p>
        </div>
      </section>
    </main>
  );
}
