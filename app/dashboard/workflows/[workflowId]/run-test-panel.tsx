"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
type IntegrationStatus = { provider: string; configured: boolean; recipientAllowed: boolean; liveExecutionEnabled: boolean; ready: boolean; missing: string[] };
type LiveRunResult = { jobId: string; runId: string; status: string; attempts: number; errorCode?: string; checkpoints: Array<{ step_id: string; step_position: number; status: string }> };
type RunHistoryItem = {
  id: string;
  mode: string;
  workflow_version: number;
  status: string;
  created_at: string;
  duration_ms: number;
  steps: Array<{ id: string; status: string; title: string; position: number }>;
};

export default function RunTestPanel({ workflowId, hasUnsavedChanges, workflowStatus, liveEmailRecipient }: { workflowId: string; hasUnsavedChanges: boolean; workflowStatus: string; liveEmailRecipient: string }) {
  const [input, setInput] = useState(`{
  "status": "ready",
  "order": { "total": 125 }
}`);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<RunResult | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [history, setHistory] = useState<RunHistoryItem[]>([]);
  const [integration, setIntegration] = useState<IntegrationStatus | null>(null);
  const [sendingLive, setSendingLive] = useState(false);
  const [liveError, setLiveError] = useState("");
  const [liveResult, setLiveResult] = useState<LiveRunResult | null>(null);
  const idempotencyKey = useRef<string | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/integrations/workspace?recipient=${encodeURIComponent(liveEmailRecipient)}`, { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : null)
      .then((data) => {
        if (cancelled || !data) return;
        const resend = Array.isArray(data.integrations)
          ? data.integrations.find((item: { provider?: string; status?: string }) => item.provider === "resend" && item.status === "connected")
          : null;
        const configured = Boolean(resend);
        const recipientAllowed = data.emailRecipientAllowed === true;
        const liveExecutionEnabled = data.liveExecutionEnabled === true;
        const missing = [
          ...(!configured ? ["workspace Resend connection"] : []),
          ...(!recipientAllowed ? ["approved recipient allowlist"] : []),
          ...(!liveExecutionEnabled ? ["AIVANTA_LIVE_EXECUTION_ENABLED"] : []),
        ];
        setIntegration({ provider: "resend", configured, recipientAllowed, liveExecutionEnabled, ready: missing.length === 0, missing });
      })
      .catch(() => { if (!cancelled) setIntegration(null); });
    return () => { cancelled = true; };
  }, [liveEmailRecipient]);

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

  async function runLive() {
    if (sendingLive || hasUnsavedChanges || workflowStatus !== "active" || !integration?.ready) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(input);
    } catch {
      setLiveError("Sample input must be valid JSON.");
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      setLiveError("Sample input must be a JSON object.");
      return;
    }

    const confirmed = window.confirm(
      `Queue a REAL workflow run? It may send an email to ${liveEmailRecipient || "the configured recipient"}. This cannot be undone.`,
    );
    if (!confirmed) return;

    if (!idempotencyKey.current) idempotencyKey.current = crypto.randomUUID();
    setSendingLive(true);
    setLiveError("");
    setLiveResult(null);
    try {
      const response = await fetch(`/api/workflows/${workflowId}/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey.current },
        body: JSON.stringify({ mode: "live", input: parsed }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not queue this live workflow.");
      const jobId = data.jobId as string;
      const runId = data.runId as string;
      let finalJob: { status: string; attempts: number; last_error_code?: string | null } | null = null;
      let checkpoints: LiveRunResult["checkpoints"] = [];
      for (let attempt = 0; attempt < 30; attempt++) {
        await new Promise(resolve => window.setTimeout(resolve, 1000));
        const statusResponse = await fetch(`/api/workflows/${workflowId}/executions/${jobId}`, { cache: "no-store" });
        const statusData = await statusResponse.json();
        if (!statusResponse.ok) throw new Error(statusData.error || "Could not read execution status.");
        finalJob = statusData.job;
        checkpoints = Array.isArray(statusData.checkpoints) ? statusData.checkpoints : [];
        if (finalJob && ["succeeded", "dead_letter"].includes(finalJob.status)) break;
      }
      if (!finalJob || !["succeeded", "dead_letter"].includes(finalJob.status)) {
        throw new Error("The workflow is still queued or running. Its job is saved; check run history before trying again.");
      }
      idempotencyKey.current = null;
      setLiveResult({ jobId, runId, status: finalJob.status, attempts: finalJob.attempts, errorCode: finalJob.last_error_code ?? undefined, checkpoints });
      await loadHistory();
    } catch (caught) {
      setLiveError(caught instanceof Error ? caught.message : "Could not execute this live run.");
      // Keep the same idempotency key after a network error to avoid sending a duplicate.
    } finally {
      setSendingLive(false);
    }
  }

  return (
    <section id="workflow-test-panel" className="dry-run-panel" aria-labelledby="dry-run-title" tabIndex={-1}>
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
      <div className="live-integration-card">
        <div className="live-integration-top"><strong>Live email integration</strong><span className={integration?.ready ? "integration-ready" : "integration-pending"}>{integration?.ready ? "READY" : "SETUP REQUIRED"}</span></div>
        <p>{workflowStatus !== "active"
          ? "Activate this workflow before a live email can be sent."
          : hasUnsavedChanges
            ? "Save your workflow changes before live execution."
            : integration?.ready
              ? "Workspace Resend credentials are saved, the recipient is approved, and durable live execution is enabled."
              : integration?.recipientAllowed === false && liveEmailRecipient
                ? "This recipient is not on the server-approved allowlist. Ask the workspace administrator to approve it."
                : `Complete setup: ${integration?.missing?.join(", ") || "workspace integration status unavailable"}.`}</p>
        <button className="builder-run live-run-button" type="button" onClick={() => void runLive()} disabled={sendingLive || hasUnsavedChanges || workflowStatus !== "active" || !integration?.ready}>
          {sendingLive ? "Running workflow…" : "▶ Run live workflow"}
        </button>
        {liveError && <p className="dry-run-error" role="alert">{liveError}</p>}
        {liveResult && <div className="live-run-success" role="status"><strong>Durable execution {liveResult.status}</strong><span>Run {liveResult.runId.slice(0, 8)} · {liveResult.attempts} attempt(s) · {liveResult.checkpoints.length} checkpoints</span><p>{liveResult.status === "succeeded" ? "The workflow completed. Its actual step results are saved in run history." : `The workflow stopped and was not automatically replayed. ${liveResult.errorCode ? `Error: ${liveResult.errorCode}. ` : ""}Check run history before deciding what to do next.`}</p></div>}
      </div>
      {result && <div className="dry-run-results" role="status">
        <div className="dry-run-results-heading"><strong>Run passed</strong><span>{version ? `Version ${version} · ` : ""}{result.steps.length} steps</span></div>
        <ol>{result.steps.map((step) => <li key={step.stepId} className={`run-step-${step.status}`}>
          <span className="run-step-mark">{step.status === "skipped" ? "–" : "✓"}</span>
          <span><strong>{step.title}</strong><small>{step.type} · {step.status}{step.conditionMatched === undefined ? "" : step.conditionMatched ? " · condition matched" : " · condition did not match"}</small><small>{step.message}</small></span>
        </li>)}</ol>
        <p className="dry-run-hint">No external side effects were performed.</p>
      </div>}
      <div className="run-history">
        <div className="panel-add-heading"><strong>Run history</strong><span>Dry-runs and durable live runs</span></div>
        {history.length ? <ol>{history.slice(0, 6).map((run) => <li key={run.id}>
          <span className={`run-history-status ${run.status === "succeeded" ? "status-ok" : "status-failed"}`}>{run.status === "succeeded" ? "✓" : "!"}</span>
          <span className="run-history-copy"><strong>{run.mode === "live" ? "Live email" : "Dry run"} · Version {run.workflow_version}</strong><small>{run.steps?.length ?? 0} steps · {run.duration_ms} ms</small><time dateTime={run.created_at}>{new Date(run.created_at).toLocaleString()}</time></span>
        </li>)}</ol> : <p className="version-empty">Your dry-run results will appear here.</p>}
      </div>
    </section>
  );
}
