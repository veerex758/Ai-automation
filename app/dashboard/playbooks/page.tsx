"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import DashboardSidebar from "../dashboard-sidebar";
import "./playbooks.css";

type PlaybookSummary = {
  id: string; name: string; description: string; status: string; updated: string; isPlaybook: boolean;
};
type WorkflowListResponse = { workflows?: PlaybookSummary[]; error?: string };
const filters = ["All", "Active", "Draft", "Paused", "Archived"] as const;
type Filter = (typeof filters)[number];

export default function PlaybooksLibraryPage() {
  const [items, setItems] = useState<PlaybookSummary[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Filter>("All");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (quiet = false) => {
    quiet ? setRefreshing(true) : setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/workflows", { cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as WorkflowListResponse;
      if (!response.ok) throw new Error(payload.error || "Could not load your Playbooks.");
      setItems((payload.workflows ?? []).filter((item) => item.isPlaybook === true));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load your Playbooks.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => ({
    all: items.length,
    active: items.filter((item) => item.status === "Active").length,
    draft: items.filter((item) => item.status === "Draft").length,
    paused: items.filter((item) => item.status === "Paused").length,
  }), [items]);

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return items.filter((item) =>
      (!term || (item.name + " " + item.description).toLowerCase().includes(term)) &&
      (status === "All" || item.status === status)
    );
  }, [items, query, status]);

  return (
    <main className="app-shell playbook-shell">
      <DashboardSidebar activePage="playbooks" />
      <section className="dashboard-main">
        <header className="dashboard-topbar">
          <div className="breadcrumbs">Workspace <span>/</span><strong>Playbooks</strong></div>
          <span className="environment-badge">Workspace playbooks</span>
        </header>
        <div className="dashboard-content playbook-content">
          <div className="playbook-index-heading">
            <div>
              <div className="playbook-eyebrow">REXNORA · OUTCOME-FIRST AUTOMATION</div>
              <h1>Your Playbooks</h1>
              <p>Manage the business processes saved in this workspace. Open a Control Room to inspect rules, permissions, approvals, safe previews and outcomes.</p>
            </div>
            <Link className="playbook-primary" href="/dashboard/playbooks/new">＋ Create Playbook</Link>
          </div>

          <div className="playbook-index-stats" aria-label="Playbook summary">
            <div><span>{counts.all}</span><strong>Total Playbooks</strong><small>Saved in this workspace</small></div>
            <div><span>{counts.active}</span><strong>Active</strong><small>Assigned to new enquiries</small></div>
            <div><span>{counts.draft}</span><strong>Drafts</strong><small>Not activated</small></div>
            <div><span>{counts.paused}</span><strong>Paused</strong><small>Not receiving new work</small></div>
          </div>

          <section className="playbook-index-toolbar" aria-label="Filter Playbooks">
            <label className="playbook-index-search">
              <span aria-hidden="true">⌕</span>
              <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Playbooks" aria-label="Search Playbooks" />
            </label>
            <div className="playbook-index-filters" role="group" aria-label="Filter by status">
              {filters.map((filter) => (
                <button key={filter} type="button" className={status === filter ? "selected" : ""} aria-pressed={status === filter} onClick={() => setStatus(filter)}>{filter}</button>
              ))}
              <button className="playbook-index-refresh" type="button" onClick={() => void load(true)} disabled={loading || refreshing}>{refreshing ? "Refreshing…" : "Refresh"}</button>
            </div>
          </section>

          {error && <div className="playbook-alert error" role="alert">{error}</div>}
          {loading && <div className="playbook-panel" role="status">Loading workspace Playbooks…</div>}
          {!loading && !error && items.length === 0 && (
            <section className="playbook-panel playbook-index-empty">
              <div className="playbook-index-empty-mark" aria-hidden="true">◇</div>
              <h2>No Playbooks yet</h2>
              <p>Start with a business outcome. Rexnora will prepare an inactive draft for review before providers are connected or anything is activated.</p>
              <Link className="playbook-primary" href="/dashboard/playbooks/new">Create your first Playbook <span>→</span></Link>
            </section>
          )}
          {!loading && !error && items.length > 0 && visible.length === 0 && (
            <section className="playbook-panel"><div className="playbook-empty">No Playbooks match this search and status filter. Change the filters or clear your search.</div></section>
          )}
          {!loading && !error && visible.length > 0 && (
            <div className="playbook-index-grid">
              {visible.map((item) => (
                <article className="playbook-index-card" key={item.id}>
                  <div className="playbook-index-card-top">
                    <span className="playbook-index-symbol" aria-hidden="true">◇</span>
                    <span className={"playbook-index-status status-" + item.status.toLowerCase()}>{item.status}</span>
                  </div>
                  <h2>{item.name}</h2>
                  <p>{item.description || "No outcome description was saved."}</p>
                  <div className="playbook-index-card-footer">
                    <span>Updated {item.updated || "—"}</span>
                    <Link href={"/dashboard/playbooks/" + encodeURIComponent(item.id)}>Open Control Room <span aria-hidden="true">↗</span></Link>
                  </div>
                </article>
              ))}
            </div>
          )}
          <div className="playbook-bottom-links">
            <Link href="/dashboard">Back to overview</Link>
            <Link href="/dashboard/real-estate">Open real-estate workspace</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
