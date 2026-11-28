"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import DashboardSidebar from "../../../dashboard-sidebar";
import "../../playbooks.css";

type Lead = { id: string; full_name: string; preferred_location: string | null; lead_score: number; created_at: string };
type ReplayResult = {
  leadId: string;
  leadName: string;
  confidence: number | null;
  requiresReview: boolean;
  reviewReasons: string[];
  matchedRules: number;
  rules: Array<{ id: string; name: string; outcome: string; reason: string }>;
  actions: Array<{ stepId: string; nodeId: string; operationId: string; permission: string; preview: string }>;
};
type ControlResponse = { workflow?: { id: string; version: number; name: string }; error?: string };
type LeadResponse = { leads?: Lead[]; error?: string };

export default function PlaybookSafePreviewPage() {
  const params = useParams<{ playbookId: string }>();
  const playbookId = params.playbookId;
  const [workflow, setWorkflow] = useState<ControlResponse["workflow"]>(undefined);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [results, setResults] = useState<ReplayResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const [definitionResponse, leadsResponse] = await Promise.all([
          fetch("/api/workflows/" + encodeURIComponent(playbookId) + "/definition", { cache: "no-store" }),
          fetch("/api/real-estate/leads?limit=50", { cache: "no-store" }),
        ]);
        const definition = await definitionResponse.json() as ControlResponse;
        const leadData = await leadsResponse.json() as LeadResponse;
        if (!definitionResponse.ok || !definition.workflow) throw new Error(definition.error || "Could not load Playbook version.");
        if (!leadsResponse.ok) throw new Error(leadData.error || "Could not load historical enquiries.");
        const available = leadData.leads ?? [];
        if (active) {
          setWorkflow(definition.workflow);
          setLeads(available);
          setSelected(available.slice(0, 50).map((lead) => lead.id));
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Safe Preview could not load.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [playbookId]);

  async function replay() {
    if (!workflow || selected.length === 0 || running) return;
    setRunning(true);
    setError("");
    setResults([]);
    try {
      const response = await fetch("/api/real-estate/playbooks/replay", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ workflowId: playbookId, version: workflow.version, leadIds: selected }),
      });
      const data = await response.json() as { results?: ReplayResult[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Safe Preview failed.");
      setResults(data.results ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Safe Preview failed.");
    } finally {
      setRunning(false);
    }
  }

  return <main className="app-shell playbook-shell">
    <DashboardSidebar activePage="playbooks" />
    <section className="dashboard-main">
      <header className="dashboard-topbar">
        <div className="breadcrumbs">Workspace <span>/</span><Link href="/dashboard/playbooks">Playbooks</Link><span>/</span><Link href={"/dashboard/playbooks/" + encodeURIComponent(playbookId)}>Control Room</Link><span>/</span><strong>Safe Preview</strong></div>
        <span className="environment-badge">Read-only replay</span>
      </header>
      <div className="dashboard-content playbook-content">
        <div className="playbook-heading">
          <div className="playbook-eyebrow">REXNORA PLAYBOOKS · SAFE PREVIEW</div>
          <h1>Test your rules against past enquiries</h1>
          <p>Rexnora evaluates the selected, saved Playbook version against existing lead data. It does not call Gemini, Resend, WhatsApp or other providers.</p>
        </div>
        <div className="playbook-alert">Read-only preview · Maximum 50 enquiries · No workflow runs, provider calls or database writes</div>
        {loading && <div className="playbook-panel">Loading historical enquiries…</div>}
        {error && <div className="playbook-alert error" role="alert">{error}</div>}
        {!loading && <>
          <section className="playbook-panel">
            <div className="playbook-panel-heading"><span>01</span><div><h2>Choose historical enquiries</h2><p>{leads.length} recent enquiries loaded. Select up to 50 for deterministic replay.</p></div></div>
            <div className="playbook-checks">
              {leads.map((lead) => <label key={lead.id}><input type="checkbox" checked={selected.includes(lead.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, lead.id].slice(0, 50) : current.filter((id) => id !== lead.id))} />{lead.full_name} · {lead.preferred_location || "Location not set"} · Score {lead.lead_score}</label>)}
            </div>
            <div className="playbook-form-footer"><span>{selected.length}/50 selected · Version {workflow?.version ?? "—"}</span><button className="playbook-primary" type="button" disabled={running || !selected.length || !workflow} onClick={() => void replay()}>{running ? "Replaying…" : "Run Safe Preview"} <span>→</span></button></div>
          </section>
          {results.length > 0 && <section className="playbook-review">
            <div className="playbook-review-heading"><div><div className="playbook-eyebrow">02 · REPLAY RESULTS</div><h2>{results.length} enquiries evaluated</h2><p>These results show what the rules and permissions would do. They are not executions.</p></div></div>
            {results.map((result) => <article className="playbook-panel" key={result.leadId}>
              <div className="playbook-panel-heading"><span>{result.requiresReview ? "!" : "✓"}</span><div><h3>{result.leadName}</h3><p>{result.matchedRules} rule(s) matched · Confidence {result.confidence === null ? "not recorded" : Math.round(result.confidence * 100) + "%"}</p></div></div>
              {result.reviewReasons.map((reason) => <p className="playbook-footnote" key={reason}>Review: {reason}</p>)}
              {result.rules.map((rule) => <div className="playbook-threshold" key={rule.id}><span><strong>{rule.name}</strong><small>{rule.reason}</small></span><span>{rule.outcome.replaceAll("_", " ")}</span></div>)}
              {result.actions.map((action) => <div className="playbook-threshold" key={action.stepId}><span><strong>{action.nodeId} · {action.operationId}</strong><small>{action.preview.replaceAll("_", " ")}</small></span><span>{action.permission}</span></div>)}
            </article>)}
          </section>}
        </>}
      </div>
    </section>
  </main>;
}
