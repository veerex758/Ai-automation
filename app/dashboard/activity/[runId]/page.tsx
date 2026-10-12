"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import "./run-detail.css";

type RunDetail = {
  id: string;
  workflowId: string;
  workflowName: string;
  mode: string;
  status: string;
  workflowVersion: number;
  startedAt: string;
  completedAt: string;
  createdAt: string;
  durationMs: number | null;
};
type RunStep = {
  id: string;
  stepId: string;
  position: number;
  type: string;
  title: string;
  status: string;
  startedAt: string;
  completedAt: string;
};

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export default function RunDetailPage() {
  const params = useParams<{ runId: string }>();
  const runId = params.runId;
  const [run, setRun] = useState<RunDetail | null>(null);
  const [steps, setSteps] = useState<RunStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/activity/${encodeURIComponent(runId)}`, { cache: "no-store" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Could not load run details.");
        if (active) {
          setRun(result.run);
          setSteps(Array.isArray(result.steps) ? result.steps : []);
        }
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "Could not load run details.");
      } finally {
        if (active) setLoading(false);
      }
    }
    if (runId) void load();
    return () => { active = false; };
  }, [runId]);

  return (
    <main className="run-detail-shell">
      <header className="run-detail-top"><Link href="/dashboard/activity">← Activity logs</Link><Link href="/dashboard">Aivanta workspace ↗</Link></header>
      <section className="run-detail-content">
        <div className="run-detail-eyebrow">WORKFLOW EXECUTION RECORD</div>
        <h1>Run <span>details.</span></h1>
        <p className="run-detail-intro">A read-only summary of this workflow run and its recorded steps.</p>
        {loading && <div className="run-detail-message">Loading run details…</div>}
        {!loading && error && <div className="run-detail-error" role="alert"><strong>Run details unavailable</strong><p>{error}</p><Link href="/dashboard/activity">Return to activity logs</Link></div>}
        {!loading && !error && run && <>
          <section className="run-summary-card">
            <div className="run-summary-title"><div><span className="run-detail-eyebrow">WORKFLOW</span><h2>{run.workflowName}</h2><code>{run.id}</code></div><span className={"run-detail-status " + (run.status === "succeeded" ? "success" : "failure")}>{run.status}</span></div>
            <div className="run-summary-grid">
              <div><span>Mode</span><strong>{run.mode === "dry_run" ? "Dry run" : run.mode}</strong></div>
              <div><span>Workflow version</span><strong>v{run.workflowVersion}</strong></div>
              <div><span>Duration</span><strong>{typeof run.durationMs === "number" && Number.isFinite(run.durationMs) ? `${Math.max(0, Math.round(run.durationMs))} ms` : "—"}</strong></div>
              <div><span>Started</span><strong>{dateLabel(run.startedAt)}</strong></div>
              <div><span>Completed</span><strong>{dateLabel(run.completedAt)}</strong></div>
              <div><span>Recorded</span><strong>{dateLabel(run.createdAt)}</strong></div>
            </div>
          </section>
          <div className="run-steps-heading"><div><h2>Recorded steps</h2><p>Step metadata only. Inputs, outputs, and secret values are intentionally excluded.</p></div><span>{steps.length} {steps.length === 1 ? "step" : "steps"}</span></div>
          <section className="run-steps-list">
            {steps.map((step) => <article className="run-step-row" key={step.id}><span className="run-step-number">{step.position.toString().padStart(2, "0")}</span><div className="run-step-copy"><strong>{step.title}</strong><small>{step.type} · {step.stepId}</small><small>{dateLabel(step.startedAt)} — {dateLabel(step.completedAt)}</small></div><span className={"run-step-status " + (step.status === "failed" ? "failure" : "success")}>{step.status}</span></article>)}
            {steps.length === 0 && <div className="run-detail-message">No step-level records were saved for this run.</div>}
          </section>
          <div className="run-detail-actions"><Link href="/dashboard/workflows">Open workflows</Link><Link href="/dashboard/activity">Back to all activity</Link></div>
        </>}
      </section>
    </main>
  );
}
