"use client";

import { useCallback, useEffect, useState } from "react";

type RunStep = {
  stepId: string;
  position: number;
  type: "trigger" | "action" | "condition";
  title: string;
  status: "simulated" | "skipped";
  message: string;
  conditionMatched?: boolean;
};
type RunResult = { mode: "dry_run"; status: "succeeded"; sideEffectsPerformed: false; steps: RunStep[] };
type RunHistoryItem = {
  id: string;
  workflow_version: number;
  status: string;
  created_at: string;
  duration_ms: number;
  steps: Array<{ id: string; status: string; title: string; position: number }>;
};

export default function RunTestPanel({ workflowId, hasUnsavedChanges }: { workflowId: string; hasUnsavedChanges: boolean }) {
  const [input, setInput] = useState('{
  "status": "ready",
  "order": { "total": 125 }
}');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<RunResult | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [history, setHistory] = useState<RunHistoryItem[]>([]);

  const loadHistory = useCallback(async () => {
    try {
      const response = await fetch(`/api/workflows/${workflowId}/runs`, { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      setHistory(Array.isArray(data.runs) ? data.runs : []);
    } catch {
      // A history refresh should not hide a completed test result.
    }
  }, [workflowId]);

  useEffect(() => { void loadHistory(); }, [loadHistory]);

  async function runTest() {
    if (running || hasUnsavedChanges) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(input);
    } catch {
      setError("Sample input must be valid JSON.");
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      setError("Sample input must be a JSON object.");
      return;
    }

    setRunning(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch(`/api/workflows/${workflowId}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "dry_run", input: parsed }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not test this workflow.");
      setResult(data.result as RunResult);
      setVersion(data.run?.workflow_version ?? null);
      await loadHistory();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not test this workflow.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="dry-run-panel" aria-labelledby="dry-run-title">
      <div className="dry-run-heading">
        <div><span className="panel-kicker">SAFE PREVIEW</span><h2 id="dry-run-title">Test your workflow</h2>
          <p>Conditions use this sample data. Actions are simulated; nothing is sent, created, or requested externally.</p>
        </div>
        <span className="dry-run-badge">DRY RUN</span>
      </div>
      <label htmlFor="dry-run-input">Sample input · JSON object</label>
      <textarea id="dry-run-input" rows={4} spellCheck={false} value={input} onChange={(event) => setInput(event.target.value)} />
      {hasUnsavedChanges && <p className="dry-run-hint">Save your latest workflow changes before running this test.</p>}
      {error && <p className="dry-run-error" role="alert">{error}</p>}
      <button className="builder-run dry-run-submit" type="button" onClick={() => void runTest()} disabled={running || hasUnsavedChanges}>
        {running ? "Testing…" : "▶ Run safe test"}
      </button>
      {result && <div className="dry-run-results" role="status">
        <div className="dry-run-results-heading"><strong>Run passed</strong><span>{version ? `Version ${version} · ` : ""}{result.steps.length} steps</span></div>
        <ol>{result.steps.map((step) => <li key={step.stepId} className={`run-step-${step.status}`}>
          <span className="run-step-mark">{step.status === "skipped" ? "–" : "✓"}</span>
          <span><strong>{step.title}</strong><small>{step.type} · {step.status}{step.conditionMatched === undefined ? "" : step.conditionMatched ? " · condition matched" : " · condition did not match"}</small><small>{step.message}</small></span>
        </li>)}</ol>
        <p className="dry-run-hint">No external side effects were performed.</p>
      </div>}
      <div className="run-history">
        <div className="panel-add-heading"><strong>Test run history</strong><span>Recent dry-runs</span></div>
        {history.length ? <ol>{history.slice(0, 6).map((run) => <li key={run.id}>
          <span className={`run-history-status ${run.status === "succeeded" ? "status-ok" : "status-failed"}`}>{run.status === "succeeded" ? "✓" : "!"}</span>
          <span className="run-history-copy"><strong>Version {run.workflow_version}</strong><small>{run.steps?.length ?? 0} steps · {run.duration_ms} ms</small><time dateTime={run.created_at}>{new Date(run.created_at).toLocaleString()}</time></span>
        </li>)}</ol> : <p className="version-empty">Your dry-run results will appear here.</p>}
      </div>
    </section>
  );
}
