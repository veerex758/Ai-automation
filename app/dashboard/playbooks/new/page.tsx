"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import DashboardSidebar from "../../dashboard-sidebar";
import "../playbooks.css";

type RegistryStep = {
  id: string;
  nodeId: string;
  operationId: string;
  kind: "trigger" | "action";
  input: Record<string, unknown>;
};
type WorkflowNode = {
  id: string;
  type: "trigger" | "action" | "condition";
  title: string;
  description?: string;
};
type GeneratedDraft = {
  definition?: { version: 1; nodes: WorkflowNode[]; edges?: Array<Record<string, unknown>> };
  registrySteps?: RegistryStep[];
  summary?: string;
  error?: string;
  errorCode?: string;
};
type Rule = { id: string; nodeId: string; name: string; rationale: string };
type ActionPolicy = {
  stepId: string;
  nodeId: string;
  operationId: string;
  permission: "auto" | "ask_first" | "never";
};

const reviewDefaults = {
  confidenceThreshold: 0.8,
  reviewMissingFields: true,
  reviewWhenNoRuleMatches: true,
  reviewProviderFailures: true,
};

async function responseJson<T>(response: Response): Promise<T> {
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = result && typeof result === "object" && "error" in result ? String(result.error) : "The request could not be completed.";
    throw new Error(message);
  }
  return result as T;
}

function permissionLabel(value: ActionPolicy["permission"]) {
  if (value === "auto") return "Automatically";
  if (value === "never") return "Never";
  return "Ask me first";
}

export default function NewPlaybookPage() {
  const router = useRouter();
  const [outcome, setOutcome] = useState("Qualify each new property enquiry, identify serious buyers or tenants, and notify the right person at the agency.");
  const [draft, setDraft] = useState<GeneratedDraft | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [policies, setPolicies] = useState<ActionPolicy[]>([]);
  const [confidence, setConfidence] = useState(0.8);
  const [reviewMissingFields, setReviewMissingFields] = useState(true);
  const [reviewUnmatchedRules, setReviewUnmatchedRules] = useState(true);
  const [reviewProviderFailures, setReviewProviderFailures] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!outcome.trim() || generating) return;
    setGenerating(true);
    setError("");
    setNotice("");
    setDraft(null);
    try {
      const prompt = [
        "Create a real-estate agency Playbook for this business outcome: " + outcome.trim(),
        "Use only registered Rexnora operations. Do not invent integrations, tools, data sources or delivery channels.",
        "Gemini may extract and classify enquiry details into structured fields. Use deterministic IF conditions for explicit business rules.",
        "Only use Resend to notify a specifically approved agency inbox. Do not contact the property enquiry customer unless a separate consent-aware process is explicitly represented.",
        "Keep the graph simple and connected. Include a supported intake trigger, qualification where available, explicit IF branches for the stated rules, and an agency notification only if a supported registered operation exists.",
        "Return an inactive draft only. Never activate or execute anything."
      ].join("\n\n");
      const response = await fetch("/api/ai/generate-workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const generated = await responseJson<GeneratedDraft>(response);
      if (!generated.definition || !Array.isArray(generated.definition.nodes) ||
          !Array.isArray(generated.registrySteps) || generated.registrySteps.length === 0) {
        throw new Error("Gemini did not return a complete registered workflow. No Playbook draft was saved.");
      }
      const generatedRules = generated.definition.nodes
        .filter((node) => node.type === "condition")
        .map((node, index) => ({
          id: node.id,
          nodeId: node.id,
          name: node.title?.trim() || "Business rule " + (index + 1),
          rationale: node.description?.trim() || "",
        }));
      const generatedPolicies = generated.registrySteps
        .filter((step) => step.kind === "action" && !["if", "switch"].includes(step.nodeId))
        .map((step) => ({
          stepId: step.id,
          nodeId: step.nodeId,
          operationId: step.operationId,
          permission: step.nodeId === "gemini" ? "auto" as const : "ask_first" as const,
        }));
      setRules(generatedRules);
      setPolicies(generatedPolicies);
      setDraft(generated);
      setNotice("Draft generated. Review every rule and action permission before saving.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Playbook generation failed safely.");
    } finally {
      setGenerating(false);
    }
  }

  async function saveDraft() {
    if (!draft?.definition || !draft.registrySteps || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const playbook = {
        schema: "rexnora.playbook",
        schemaVersion: 1,
        goal: { industry: "real_estate", outcome: outcome.trim() },
        rules,
        actionPolicies: policies,
        review: {
          confidenceThreshold: confidence,
          reviewMissingFields,
          reviewWhenNoRuleMatches: reviewUnmatchedRules,
          reviewProviderFailures,
        },
      };
      const definition = { ...draft.definition, playbook };
      const response = await fetch("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({
          name: "Qualify property enquiries",
          description: (draft.summary || outcome).slice(0, 500),
          status: "draft",
          definition,
          registrySteps: draft.registrySteps,
        }),
      });
      const created = await responseJson<{ workflow?: { id: string } }>(response);
      if (!created.workflow?.id) throw new Error("Rexnora did not confirm the Playbook draft was saved.");
      router.push("/dashboard/playbooks/" + encodeURIComponent(created.workflow.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this Playbook draft.");
    } finally {
      setSaving(false);
    }
  }

  return <main className="app-shell playbook-shell">
    <DashboardSidebar activePage="playbooks" />
    <section className="dashboard-main">
      <header className="dashboard-topbar">
        <div className="breadcrumbs">Workspace <span>/</span><strong>Playbooks</strong></div>
        <span className="environment-badge">Draft setup · no execution</span>
      </header>
      <div className="dashboard-content playbook-content">
        <div className="playbook-heading">
          <div className="playbook-eyebrow">REXNORA PLAYBOOKS · REAL ESTATE</div>
          <h1>What outcome should Rexnora handle?</h1>
          <p>Describe the business result. Rexnora will propose a process, then let you review the rules and every action before saving.</p>
        </div>

        <div className="playbook-steps" aria-label="Setup steps">
          <div className={draft ? "playbook-step complete" : "playbook-step active"}><span>1</span><div><strong>Describe the outcome</strong><small>Tell Rexnora what your agency needs.</small></div></div>
          <div className={draft ? "playbook-step active" : "playbook-step"}><span>2</span><div><strong>Review decisions</strong><small>Choose what can happen automatically.</small></div></div>
          <div className="playbook-step"><span>3</span><div><strong>Save a draft</strong><small>Nothing is activated or executed.</small></div></div>
        </div>

        {error && <div className="playbook-alert error" role="alert">{error}</div>}
        {notice && <div className="playbook-alert" role="status">{notice}</div>}

        <section className="playbook-panel">
          <div className="playbook-panel-heading"><span>01</span><div><h2>Business outcome</h2><p>Write what should improve for your agency, not a list of software steps.</p></div></div>
          <form onSubmit={generate}>
            <label className="playbook-field-label" htmlFor="playbook-outcome">What should Rexnora achieve?</label>
            <textarea id="playbook-outcome" value={outcome} onChange={(event) => setOutcome(event.target.value)} maxLength={240} rows={3} required />
            <div className="playbook-form-footer"><span>{outcome.length}/240 · Real-estate agencies</span><button className="playbook-primary" type="submit" disabled={generating || !outcome.trim()}>{generating ? "Preparing your draft…" : "Create my draft"} <span>→</span></button></div>
          </form>
          <p className="playbook-footnote">Gemini proposes a draft using registered operations only. It cannot activate a Playbook or send messages from this screen.</p>
        </section>

        {draft?.definition && draft.registrySteps && <section className="playbook-review">
          <div className="playbook-review-heading"><div><div className="playbook-eyebrow">02 · REVIEW BEFORE SAVING</div><h2>Your proposed process</h2><p>{draft.summary || "Review the proposed conditions and actions. Change permissions to match your agency's policy."}</p></div><span className="playbook-draft-tag">Inactive draft</span></div>

          <section className="playbook-panel">
            <div className="playbook-panel-heading"><span>A</span><div><h3>Business rules</h3><p>Each rule is linked to a condition in the generated process. The condition itself remains the source of truth.</p></div></div>
            {rules.length ? <div className="playbook-rule-list">{rules.map((rule, index) => <article className="playbook-rule-card" key={rule.nodeId}>
              <div className="playbook-rule-index">{String(index + 1).padStart(2, "0")}</div>
              <div className="playbook-rule-fields">
                <label>Rule name<input value={rule.name} maxLength={100} onChange={(event) => setRules((current) => current.map((item) => item.nodeId === rule.nodeId ? { ...item, name: event.target.value } : item))} /></label>
                <label>Why this matters<textarea rows={2} maxLength={240} value={rule.rationale} onChange={(event) => setRules((current) => current.map((item) => item.nodeId === rule.nodeId ? { ...item, rationale: event.target.value } : item))} /></label>
              </div>
            </article>)}</div> : <div className="playbook-empty">Gemini did not add a conditional rule. You can save this simple process, or change the outcome and generate a more specific rule-based draft.</div>}
          </section>

          <section className="playbook-panel">
            <div className="playbook-panel-heading"><span>B</span><div><h3>What may each action do?</h3><p>Choose an explicit permission. External actions default to Ask me first.</p></div></div>
            {policies.length ? <div className="playbook-action-list">{policies.map((policy) => {
              const node = draft.definition!.nodes.find((item) => item.id === policy.stepId);
              const title = node?.title || policy.operationId.replaceAll("_", " ");
              return <article className="playbook-action-card" key={policy.stepId}>
                <div className="playbook-action-copy"><strong>{title}</strong><small>{policy.nodeId} · {policy.operationId}</small></div>
                <label><span>Permission</span><select value={policy.permission} onChange={(event) => setPolicies((current) => current.map((item) => item.stepId === policy.stepId ? { ...item, permission: event.target.value as ActionPolicy["permission"] } : item))}>
                  <option value="auto">Auto — after all checks</option>
                  <option value="ask_first">Ask me first</option>
                  <option value="never">Never allow</option>
                </select></label>
              </article>;
            })}</div> : <div className="playbook-empty">This draft has no registered actions. It cannot perform external work until an action is configured.</div>}
          </section>

          <section className="playbook-panel">
            <div className="playbook-panel-heading"><span>C</span><div><h3>When should a person review?</h3><p>Uncertain or incomplete enquiries should not be silently routed.</p></div></div>
            <label className="playbook-threshold"><span><strong>Minimum AI confidence</strong><small>Below this value, the enquiry needs review.</small></span><input type="number" min="0" max="1" step="0.05" value={confidence} onChange={(event) => setConfidence(Math.min(1, Math.max(0, Number(event.target.value))))} /></label>
            <div className="playbook-checks">
              <label><input type="checkbox" checked={reviewMissingFields} onChange={(event) => setReviewMissingFields(event.target.checked)} /> Review enquiries with missing required details</label>
              <label><input type="checkbox" checked={reviewUnmatchedRules} onChange={(event) => setReviewUnmatchedRules(event.target.checked)} /> Review when no business rule matches</label>
              <label><input type="checkbox" checked={reviewProviderFailures} onChange={(event) => setReviewProviderFailures(event.target.checked)} /> Review failed integrations and delivery attempts</label>
            </div>
          </section>

          <div className="playbook-save-row">
            <div><strong>Save as a draft</strong><small>Permissions are stored with this version. Activation is deliberately unavailable until the decision controls are enforced by the runtime.</small></div>
            <button className="playbook-primary" type="button" disabled={saving || !outcome.trim() || policies.some((policy) => !policy.permission)} onClick={() => void saveDraft()}>{saving ? "Saving draft…" : "Save Playbook draft"} <span>→</span></button>
          </div>
        </section>}

        <div className="playbook-bottom-links"><Link href="/dashboard/real-estate">Open real-estate leads ↗</Link><span>Advanced graph editing remains available after a draft is saved.</span></div>
      </div>
    </section>
  </main>;
}
