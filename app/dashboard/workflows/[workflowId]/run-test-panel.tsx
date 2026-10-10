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
type LiveRunResult = { run: { id: string; status: string; workflow_version: number; duration_ms: number }; steps: Array<{ step_id: string; position: number; step_type: RunStep["type"]; title: string; status: "simulated" | "skipped" | "executed" | "failed"; result: Record<string, unknown> }>; sideEffectsPerformed: boolean; providerMessageId?: string };
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
    fetch(`/api/integrations/resend/status?recipient=${encodeURIComponent(liveEmailRecipient)}`, { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : null)
      .then((data) => { if (!cancelled && data) setIntegration(data as IntegrationStatus); })
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
      `Send a REAL email to ${liveEmailRecipient || "the configured recipient"} using Resend? This cannot be undone.`,
    );
    if (!confirmed) return;

    if (!idempotencyKey.current) idempotencyKey.current = crypto.randomUUID();
    setSendingLive(true);
    setLiveError("");
    setLiveResult(null);
    try {
      const response = await fetch(`/api/workflows/${workflowId}/live-run`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey.current },
        body: JSON.stringify({ input: parsed }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not execute this live run.");
      idempotencyKey.current = null;
      if (data.duplicate) {
        setLiveError("This request was already processed. Check run history before starting another live run.");
      } else {
        setLiveResult(data as LiveRunResult);
      }
      await loadHistory();
    } catch (caught) {
      setLiveError(caught instanceof Error ? caught.message : "Could not execute this live run.");
      // Keep the same idempotency key after a network error to avoid sending a duplicate.
    } finally {
      setSendingLive(false);
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
      <div className="live-integration-card">
        <div className="live-integration-top"><strong>Live email integration</strong><span className={integration?.ready ? "integration-ready" : "integration-pending"}>{integration?.ready ? "READY" : "SETUP REQUIRED"}</span></div>
        <p>{workflowStatus !== "active"
          ? "Activate this workflow before a live email can be sent."
          : hasUnsavedChanges
            ? "Save your workflow changes before live execution."
            : integration?.ready
              ? "Resend is configured and this recipient is approved for live email."
              : integration?.recipientAllowed === false && liveEmailRecipient
                ? "This recipient is not on the server-approved allowlist. Ask the workspace administrator to approve it."
                : `Configure the server environment: ${integration?.missing?.join(", ") || "email integration status unavailable"}.`}</p>
        <button className="builder-run live-run-button" type="button" onClick={() => void runLive()} disabled={sendingLive || hasUnsavedChanges || workflowStatus !== "active" || !integration?.ready}>
          {sendingLive ? "Sending…" : "✉ Run live email"}
        </button>
        {liveError && <p className="dry-run-error" role="alert">{liveError}</p>}
        {liveResult && <div className="live-run-success" role="status"><strong>Live run {liveResult.run.status}</strong><span>Version {liveResult.run.workflow_version} · {liveResult.run.duration_ms} ms</span><p>{liveResult.run.status === "failed" ? "The email action failed. Check run history and provider configuration before retrying." : liveResult.sideEffectsPerformed ? "Resend accepted the email. A real message was sent to the configured recipient." : "No email was sent because the workflow condition skipped the action."}</p></div>}
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
        <div className="panel-add-heading"><strong>Run history</strong><span>Dry-runs and live email</span></div>
        {history.length ? <ol>{history.slice(0, 6).map((run) => <li key={run.id}>
          <span className={`run-history-status ${run.status === "succeeded" ? "status-ok" : "status-failed"}`}>{run.status === "succeeded" ? "✓" : "!"}</span>
          <span className="run-history-copy"><strong>{run.mode === "live" ? "Live email" : "Dry run"} · Version {run.workflow_version}</strong><small>{run.steps?.length ?? 0} steps · {run.duration_ms} ms</small><time dateTime={run.created_at}>{new Date(run.created_at).toLocaleString()}</time></span>
        </li>)}</ol> : <p className="version-empty">Your dry-run results will appear here.</p>}
      </div>
    </section>
  );
}
