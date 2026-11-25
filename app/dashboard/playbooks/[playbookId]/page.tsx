"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import DashboardSidebar from "../../dashboard-sidebar";
import "../playbooks.css";

type Playbook = {
  schema: "rexnora.playbook";
  schemaVersion: 1;
  goal: { industry: "real_estate"; outcome: string };
  rules: Array<{ id: string; nodeId: string; name: string; rationale: string }>;
  actionPolicies: Array<{ stepId: string; nodeId: string; operationId: string; permission: "auto" | "ask_first" | "never" }>;
  review: { confidenceThreshold: number; reviewMissingFields: boolean; reviewWhenNoRuleMatches: boolean; reviewProviderFailures: boolean };
};
type DefinitionResponse = {
  workflow?: { id: string; name: string; description: string; status: string; version: number };
  definition?: { playbook?: Playbook; nodes?: Array<{ id: string; title: string; type: string }> };
  error?: string;
  detail?: string;
};

const permissionCopy = {
  auto: "Automatically · subject to all runtime checks",
  ask_first: "Ask me first · waiting for approval controls",
  never: "Never · blocked by policy",
};

export default function PlaybookControlRoomPage() {
  const params = useParams<{ playbookId: string }>();
  const playbookId = params.playbookId;
  const [data, setData] = useState<DefinitionResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [statusNotice, setStatusNotice] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/workflows/" + encodeURIComponent(playbookId) + "/definition", {
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
        const result = await response.json().catch(() => ({})) as DefinitionResponse;
        if (!response.ok) throw new Error(result.error || "Could not load this Playbook.");
        if (!result.workflow || !result.definition?.playbook) throw new Error("This workflow does not contain a valid Playbook definition.");
        if (active) setData(result);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Could not load this Playbook.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [playbookId]);

  const workflow = data?.workflow;
  const playbook = data?.definition?.playbook;
  const nodes = data?.definition?.nodes ?? [];

  async function changeStatus() {
    if (!workflow || updatingStatus || !["draft", "paused", "active"].includes(workflow.status)) return;
    const nextStatus = workflow.status === "active" ? "paused" : "active";
    setUpdatingStatus(true);
    setError("");
    setStatusNotice("");
    try {
      const response = await fetch("/api/workflows/" + encodeURIComponent(playbookId), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "The Playbook status could not be changed.");
      setData((current) => current?.workflow ? {
        ...current,
        workflow: { ...current.workflow, status: nextStatus },
      } : current);
      setStatusNotice(nextStatus === "active"
        ? "Playbook activated. New real-estate intake will be bound to this saved version; verify actual processing in the Outcome Ledger."
        : "Playbook paused. New enquiries will no longer be assigned to this Playbook.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The Playbook status could not be changed.");
    } finally {
      setUpdatingStatus(false);
    }
  }

  return <main className="app-shell playbook-shell">
    <DashboardSidebar activePage="playbooks" />
    <section className="dashboard-main">
      <header className="dashboard-topbar">
        <div className="breadcrumbs">Workspace <span>/</span><Link href="/dashboard/playbooks/new">Playbooks</Link><span>/</span><strong>Control Room</strong></div>
        <span className="environment-badge">Versioned Playbook</span>
      </header>
      <div className="dashboard-content playbook-content">
        <div className="playbook-review-heading">
          <div>
            <div className="playbook-eyebrow">REXNORA PLAYBOOKS · CONTROL ROOM</div>
            <h1>{workflow?.name || "Playbook Control Room"}</h1>
            <p>{playbook?.goal.outcome || "View the current Playbook definition, decisions and operating state."}</p>
          </div>
          {workflow && <span className="playbook-draft-tag">Version {workflow.version} · {workflow.status}</span>}
        </div>

        {loading && <div className="playbook-panel" role="status">Loading your Playbook…</div>}
        {!loading && error && <div className="playbook-alert error" role="alert">{error}</div>}

        {!loading && !error && playbook && workflow && <>
          <div className="playbook-alert" role="status">
            Activation is checked server-side against the supported Gemini and Resend runtime, the saved version, a successful test run, verified provider connections and operation approvals. External actions still pass the Playbook policy and review gates.
          </div>
          {statusNotice && <div className="playbook-alert" role="status">{statusNotice}</div>}

          <div className="playbook-steps">
            <div className="playbook-step active"><span>{workflow.status === "active" ? "●" : "D"}</span><div><strong>Playbook status</strong><small>{workflow.status === "active" ? "Active version · policy gate still applies" : "Draft · not running"}</small></div></div>
            <div className="playbook-step"><span>{playbook.rules.length}</span><div><strong>Business rules</strong><small>Linked to deterministic IF conditions</small></div></div>
            <div className="playbook-step"><span>{playbook.actionPolicies.length}</span><div><strong>Controlled actions</strong><small>Explicit permission for each registered action</small></div></div>
          </div>

          <section className="playbook-panel">
            <div className="playbook-panel-heading"><span>01</span><div><h2>Business rules</h2><p>These labels explain the conditions in the saved graph. The graph predicates remain the execution source of truth.</p></div></div>
            {playbook.rules.length ? <div className="playbook-rule-list">{playbook.rules.map((rule) => {
              const node = nodes.find((item) => item.id === rule.nodeId);
              return <article className="playbook-rule-card" key={rule.id}>
                <div className="playbook-rule-index">IF</div>
                <div className="playbook-rule-fields">
                  <div><strong>{rule.name}</strong><small>{node?.title || rule.nodeId}</small></div>
                  <p>{rule.rationale || "No additional explanation supplied."}</p>
                </div>
              </article>;
            })}</div> : <div className="playbook-empty">No conditional rules are defined in this Playbook.</div>}
          </section>

          <section className="playbook-panel">
            <div className="playbook-panel-heading"><span>02</span><div><h2>Action permissions</h2><p>The durable worker checks these exact permissions against the active workflow version immediately before provider work.</p></div></div>
            {playbook.actionPolicies.map((policy) => <article className="playbook-action-card" key={policy.stepId}>
              <div className="playbook-action-copy"><strong>{nodes.find((node) => node.id === policy.stepId)?.title || policy.operationId}</strong><small>{policy.nodeId} · {policy.operationId}</small></div>
              <span className="playbook-draft-tag">{permissionCopy[policy.permission]}</span>
            </article>)}
          </section>

          <section className="playbook-panel">
            <div className="playbook-panel-heading"><span>03</span><div><h2>Human review policy</h2><p>Settings stored with this immutable workflow version.</p></div></div>
            <div className="playbook-action-list">
              <div className="playbook-threshold"><span><strong>Minimum confidence</strong><small>Enquiries below this score should be reviewed.</small></span><strong>{Math.round(playbook.review.confidenceThreshold * 100)}%</strong></div>
              <div className="playbook-checks">
                <span>{playbook.review.reviewMissingFields ? "✓" : "—"} Review missing required fields</span>
                <span>{playbook.review.reviewWhenNoRuleMatches ? "✓" : "—"} Review when no business rule matches</span>
                <span>{playbook.review.reviewProviderFailures ? "✓" : "—"} Review provider failures</span>
              </div>
            </div>
          </section>

          <div className="playbook-save-row">
            <div><strong>Next: verify real enquiries</strong><small>Review leads and qualification results in the real-estate workspace. Advanced graph editing is available for technical inspection only.</small></div>
            <div className="playbook-actions">
              {workflow.status !== "archived" && <button className="playbook-primary" type="button" disabled={updatingStatus} onClick={() => void changeStatus()}>
                {updatingStatus ? "Saving…" : workflow.status === "active" ? "Pause Playbook" : "Activate Playbook"}
              </button>}
              <Link className="playbook-secondary-link" href="/dashboard/real-estate">Open leads</Link>
              <Link className="playbook-secondary-link" href={"/dashboard/playbooks/" + encodeURIComponent(playbookId) + "/preview"}>Safe Preview</Link>
              <Link className="playbook-secondary-link" href={"/dashboard/playbooks/" + encodeURIComponent(playbookId) + "/inbox"}>Decision Inbox</Link>
              <Link className="playbook-secondary-link" href={"/dashboard/playbooks/" + encodeURIComponent(playbookId) + "/ledger"}>Outcome Ledger</Link>
              <Link className="playbook-primary" href={"/dashboard/workflows/" + encodeURIComponent(playbookId)}>Advanced graph ↗</Link>
            </div>
          </div>
        </>}
      </div>
    </section>
  </main>;
}
