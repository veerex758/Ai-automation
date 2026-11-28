"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import DashboardSidebar from "../dashboard-sidebar";
import "./playbooks.css";

type WorkflowSummary = {
  id: string;
  name: string;
  description: string;
  status: string;
  updated: string;
  isPlaybook?: boolean;
};

type PlaybookEntry = WorkflowSummary & {
  version: number;
  outcome: string;
};

type WorkflowsResponse = {
  workflows?: WorkflowSummary[];
  error?: string;
};

type DefinitionResponse = {
  workflow?: { version?: number };
  definition?: {
    playbook?: {
      schema?: string;
      goal?: { outcome?: string };
    };
  };
  error?: string;
};

const statusOptions = ["All", "Active", "Draft", "Paused", "Archived"];

export default function PlaybooksLibraryPage() {
  const [items, setItems] = useState<PlaybookEntry[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("All");
  const [loading, setLoading] = useState(true);
  const [scanned, setScanned] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      setNotice("");
      setItems([]);
      setScanned(0);
      try {
        const response = await fetch("/api/workflows", { cache: "no-store" });
        const payload = await response.json().catch(() => ({})) as WorkflowsResponse;
        if (!response.ok) throw new Error(payload.error || "Could not load your workspace workflows.");
        const workflows = Array.isArray(payload.workflows) ? payload.workflows : [];
        if (cancelled) return;
        setTotal(workflows.length);

        const found: PlaybookEntry[] = [];
        let inspectionFailures = 0;
        const batchSize = 6;
        for (let offset = 0; offset < workflows.length; offset += batchSize) {
          const batch = workflows.slice(offset, offset + batchSize);
          const inspected = await Promise.all(batch.map(async (workflow) => {
            if (workflow.isPlaybook !== true) return null;
            try {
              const definitionResponse = await fetch("/api/workflows/" + encodeURIComponent(workflow.id) + "/definition", {
                cache: "no-store",
                headers: { Accept: "application/json" },
              });
              const definition = await definitionResponse.json().catch(() => ({})) as DefinitionResponse;
              if (!definitionResponse.ok) {
                inspectionFailures += 1;
                return null;
              }
              if (definition.definition?.playbook?.schema !== "rexnora.playbook") return null;
              return {
                ...workflow,
                version: Number.isInteger(definition.workflow?.version) ? definition.workflow!.version! : 1,
                outcome: definition.definition.playbook.goal?.outcome?.trim() || workflow.description || "No outcome description was saved.",
              } satisfies PlaybookEntry;
            } catch {
              inspectionFailures += 1;
              return null;
            }
          }));

          if (cancelled) return;
          found.push(...inspected.filter((item): item is PlaybookEntry => item !== null));
          setItems([...found]);
          setScanned(Math.min(offset + batch.length, workflows.length));
        }

        if (!cancelled && inspectionFailures > 0) {
          setNotice("Some saved workflows could not be inspected. The Playbooks list may be incomplete; refresh to try again.");
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load your Playbooks.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [reloadKey]);

  const visibleItems = useMemo(() => items.filter((item) => {
    const matchesSearch = (item.name + " " + item.outcome + " " + item.description).toLowerCase().includes(search.toLowerCase());
    const matchesStatus = status === "All" || item.status.toLowerCase() === status.toLowerCase();
    return matchesSearch && matchesStatus;
  }), [items, search, status]);

  const counts = useMemo(() => ({
    active: items.filter((item) => item.status.toLowerCase() === "active").length,
    draft: items.filter((item) => item.status.toLowerCase() === "draft").length,
    paused: items.filter((item) => item.status.toLowerCase() === "paused").length,
  }), [items]);

  return (
    <main className="app-shell playbook-shell">
      <DashboardSidebar activePage="playbooks" />
      <section className="dashboard-main">
        <header className="dashboard-topbar">
          <div className="breadcrumbs">Workspace <span>/</span><strong>Playbooks</strong></div>
          <span className="environment-badge">Versioned business processes</span>
        </header>
        <div className="dashboard-content playbook-content playbook-library">
          <div className="playbook-review-heading">
            <div>
              <div className="playbook-eyebrow">REXNORA PLAYBOOKS</div>
              <h1>Your Playbooks</h1>
              <p>Business processes, saved as versioned drafts you can inspect, test and activate only when ready.</p>
            </div>
            <Link className="playbook-primary playbook-library-create" href="/dashboard/playbooks/new">＋ Create Playbook</Link>
          </div>

          <div className="playbook-library-stats">
            <article><span>Total Playbooks</span><strong>{items.length}</strong></article>
            <article><span>Active</span><strong>{counts.active}</strong></article>
            <article><span>Drafts</span><strong>{counts.draft}</strong></article>
            <article><span>Paused</span><strong>{counts.paused}</strong></article>
          </div>

          <div className="playbook-library-toolbar">
            <label className="playbook-library-search">
              <span aria-hidden="true">⌕</span>
              <input aria-label="Search Playbooks" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name or outcome" />
            </label>
            <div className="playbook-library-filters" aria-label="Filter Playbooks by status">
              {statusOptions.map((option) => <button type="button" key={option} className={status === option ? "active" : ""} aria-pressed={status === option} onClick={() => setStatus(option)}>{option}</button>)}
            </div>
          </div>

          {error && <div className="playbook-alert error" role="alert">{error}<button className="playbook-library-retry" type="button" onClick={() => setReloadKey((value) => value + 1)}>Try again</button></div>}
          {notice && <div className="playbook-alert" role="status">{notice}</div>}
          {loading && <div className="playbook-panel playbook-library-loading" role="status"><span className="playbook-library-spinner" />Inspecting saved workflows… {scanned} of {total}</div>}

          {!loading && !error && visibleItems.length > 0 && <div className="playbook-library-grid">
            {visibleItems.map((item) => (
              <article className="playbook-library-card" key={item.id}>
                <div className="playbook-library-card-top">
                  <span className={"playbook-library-status status-" + item.status.toLowerCase()}><i />{item.status}</span>
                  <span>Version {item.version}</span>
                </div>
                <h2>{item.name}</h2>
                <p>{item.outcome}</p>
                <div className="playbook-library-card-meta"><span>Updated {item.updated || "recently"}</span><span>{item.description ? "Saved business process" : "No description"}</span></div>
                <div className="playbook-library-card-actions">
                  <Link href={"/dashboard/playbooks/" + encodeURIComponent(item.id)}>Open Control Room <span>→</span></Link>
                  <Link href={"/dashboard/workflows/" + encodeURIComponent(item.id)} aria-label={"Edit graph for " + item.name}>Edit graph</Link>
                </div>
              </article>
            ))}
          </div>}

          {!loading && !error && !visibleItems.length && items.length > 0 && <div className="playbook-panel playbook-library-empty"><h2>No Playbooks match this view</h2><p>Change the search or status filter to see more saved Playbooks.</p><button type="button" onClick={() => { setSearch(""); setStatus("All"); }}>Clear filters</button></div>}
          {!loading && !error && items.length === 0 && <div className="playbook-panel playbook-library-empty"><div className="playbook-library-empty-mark">◇</div><h2>No Playbooks saved yet</h2><p>Start with a business outcome. Rexnora will prepare a draft for review before anything can be activated.</p><Link className="playbook-primary" href="/dashboard/playbooks/new">Create your first Playbook <span>→</span></Link></div>}

          <div className="playbook-library-footer">
            <span>{items.length} Playbook{items.length === 1 ? "" : "s"} found in {total} saved workflow{total === 1 ? "" : "s"}</span>
            <Link href="/dashboard">Back to workspace overview ↗</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
