"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import "./recovery.css";

type Recovery = {
  id: string;
  job_id: string;
  run_id: string;
  mode: "dry_run";
  status: string;
  requested_at: string;
};
type DeadLetter = {
  id: string;
  workflow_id: string;
  workflow_name: string;
  run_id: string;
  attempts: number;
  error_code: string;
  failed_at: string;
  execution_mode: string;
  workflow_version: number | null;
  status: string;
  recoveries: Recovery[];
};

export default function DeadLetterRecoveryPage() {
  const [rows, setRows] = useState<DeadLetter[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/operations/dead-letters", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load dead-letter history.");
      setRows(Array.isArray(data.dead_letters) ? data.dead_letters as DeadLetter[] : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load dead-letter history.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function recover(id: string) {
    setPendingId(id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/operations/dead-letters/${id}/replay`, {
        method: "POST",
        headers: { "Idempotency-Key": window.crypto.randomUUID() },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not queue a recovery.");
      setNotice(`Dry-run recovery queued. Run ${String(data.run_id).slice(0, 8)} · Job ${String(data.job_id).slice(0, 8)}`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not queue a recovery.");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <main className="dead-recovery-shell">
      <header className="dead-recovery-header">
        <div>
          <Link href="/dashboard/operations" className="dead-recovery-back">← Operational monitoring</Link>
          <p className="dead-recovery-eyebrow">OWNER / ADMIN CONTROL</p>
          <h1>Dead-letter recovery</h1>
          <p className="dead-recovery-intro">Inspect permanently failed jobs and create an auditable dry-run using the original workflow snapshot.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading}>Refresh</button>
      </header>

      <section className="dead-recovery-policy" aria-label="Recovery safety policy">
        <strong>Dry-run only</strong>
        <p>Recovery creates a new run from the original saved definition. It never replays a live job or sends provider requests. A live failure may have an uncertain external outcome and must be reconciled with that provider before any new live execution.</p>
      </section>

      {error && <p className="dead-recovery-error" role="alert">{error}</p>}
      {notice && <p className="dead-recovery-notice" role="status">{notice}</p>}

      {loading && rows.length === 0 ? <p className="dead-recovery-empty">Loading dead-letter history…</p> :
        rows.length === 0 ? <section className="dead-recovery-empty">No dead-letter jobs were found in this workspace.</section> :
        <section className="dead-recovery-list" aria-label="Dead-letter jobs">
          {rows.map((row) => (
            <article className="dead-recovery-card" key={row.id}>
              <div className="dead-recovery-card-top">
                <div>
                  <p className="dead-recovery-eyebrow">FAILED {new Date(row.failed_at).toLocaleString()}</p>
                  <h2>{row.workflow_name}</h2>
                  <p className="dead-recovery-code">{row.error_code}</p>
                </div>
                <span className={row.execution_mode === "dry_run" ? "dead-recovery-tag" : "dead-recovery-tag is-live"}>
                  {row.execution_mode === "dry_run" ? "DRY-RUN SOURCE" : "LIVE SOURCE"}
                </span>
              </div>
              <dl className="dead-recovery-meta">
                <div><dt>Attempts</dt><dd>{row.attempts}</dd></div>
                <div><dt>Workflow version</dt><dd>{row.workflow_version ?? "Unknown"}</dd></div>
                <div><dt>Original run</dt><dd>{row.run_id.slice(0, 8)}</dd></div>
                <div><dt>Recovery runs</dt><dd>{row.recoveries.length}</dd></div>
              </dl>
              {row.recoveries.length > 0 && (
                <div className="dead-recovery-history">
                  <strong>Previous dry-run recoveries</strong>
                  {row.recoveries.map((recovery) => (
                    <p key={recovery.id}>{recovery.status} · {new Date(recovery.requested_at).toLocaleString()} · run {recovery.run_id.slice(0, 8)}</p>
                  ))}
                </div>
              )}
              <div className="dead-recovery-actions">
                {row.execution_mode === "dry_run" ? (
                  <button type="button" onClick={() => void recover(row.id)} disabled={pendingId !== null}>
                    {pendingId === row.id ? "Queueing recovery…" : row.recoveries.length ? "Create another dry-run" : "Create dry-run recovery"}
                  </button>
                ) : (
                  <p className="dead-recovery-blocked">Automatic replay disabled. Reconcile the original provider outcome first.</p>
                )}
              </div>
            </article>
          ))}
        </section>
      }
      <p className="dead-recovery-footnote">Access is limited to the active workspace owner or administrator. Recovery requests are idempotent and recorded separately from the original dead-letter event.</p>
    </main>
  );
}
