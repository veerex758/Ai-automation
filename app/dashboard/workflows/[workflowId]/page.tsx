"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import "./builder.css";

type NodeType = "trigger" | "action" | "condition";
type WorkflowNode = { id: string; type: NodeType; title: string; description: string; settings: Record<string, string> };
type Definition = { version: 1; nodes: WorkflowNode[] };
type Workflow = { id: string; name: string; description: string; status: string };
type WorkflowVersion = { version: number; created_at: string };

const starterDefinition: Definition = { version: 1, nodes: [
  { id: "trigger-1", type: "trigger", title: "When this happens", description: "Choose an event that starts your workflow.", settings: { event: "manual" } },
] };
const nodeMeta: Record<NodeType, { label: string; icon: string; help: string }> = {
  trigger: { label: "Trigger", icon: "⚡", help: "The event that starts the workflow." },
  action: { label: "Action", icon: "↗", help: "A task the workflow should perform." },
  condition: { label: "Condition", icon: "◇", help: "A rule to check before continuing." },
};

export default function WorkflowBuilderPage() {
  const params = useParams<{ workflowId: string }>();
  const workflowId = params.workflowId;
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [definition, setDefinition] = useState<Definition>(starterDefinition);
  const [selectedId, setSelectedId] = useState("trigger-1");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [versions, setVersions] = useState<WorkflowVersion[]>([]);
  const [restoringVersion, setRestoringVersion] = useState<number | null>(null);
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<{ valid: boolean; message: string; checkedAt: string; counts?: { triggers: number; actions: number; conditions: number } } | null>(null);

  const selectedNode = definition.nodes.find((node) => node.id === selectedId) ?? definition.nodes[0] ?? null;

  const loadWorkflow = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/workflows/${workflowId}/definition`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load this workflow.");
      setWorkflow(result.workflow);
      const nextDefinition = result.definition as Definition;
      setDefinition(nextDefinition);
      setSelectedId(nextDefinition.nodes[0]?.id ?? "");
      const versionsResponse = await fetch(`/api/workflows/${workflowId}/versions`, { cache: "no-store" });
      if (versionsResponse.ok) {
        const versionsResult = await versionsResponse.json();
        setVersions(Array.isArray(versionsResult.versions) ? versionsResult.versions : []);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load this workflow.");
    } finally {
      setLoading(false);
    }
  }, [workflowId]);

  useEffect(() => { void loadWorkflow(); }, [loadWorkflow]);

  function updateSelected(updates: Partial<Pick<WorkflowNode, "title" | "description">>) {
    if (!selectedNode) return;
    setDefinition((current) => ({ ...current, nodes: current.nodes.map((node) => node.id === selectedNode.id ? { ...node, ...updates } : node) }));
  }

  function updateSetting(key: string, value: string) {
    if (!selectedNode) return;
    setDefinition((current) => ({
      ...current,
      nodes: current.nodes.map((node) => node.id === selectedNode.id
        ? { ...node, settings: { ...node.settings, [key]: value } }
        : node),
    }));
  }

  function addNode(type: Exclude<NodeType, "trigger">) {
    const id = `${type}-${Date.now().toString(36)}`;
    const node: WorkflowNode = {
      id, type, title: type === "action" ? "New action" : "Check a condition", description: "",
      settings: type === "action"
        ? { provider: "internal", operation: "create_task", recipient: "", message: "", url: "" }
        : { field: "", operator: "equals", value: "" },
    };
    setDefinition((current) => ({ ...current, nodes: [...current.nodes, node] }));
    setSelectedId(id);
    setNotice("Step added. Save your changes when you're ready.");
  }

  function removeSelected() {
    if (!selectedNode || selectedNode.type === "trigger") return;
    setDefinition((current) => ({ ...current, nodes: current.nodes.filter((node) => node.id !== selectedNode.id) }));
    setSelectedId(definition.nodes.find((node) => node.type === "trigger")?.id ?? "");
    setNotice("Step removed. Save your changes to keep this update.");
  }

  function moveNode(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 1 || target >= definition.nodes.length) return;
    setDefinition((current) => {
      const nodes = [...current.nodes];
      [nodes[index], nodes[target]] = [nodes[target], nodes[index]];
      return { ...current, nodes };
    });
  }

  async function restoreVersion(version: number) {
    if (saving || restoringVersion !== null) return;
    const confirmed = window.confirm(`Restore version ${version}? This will replace any unsaved edits. The restored snapshot will be saved as a new version, and your existing saved versions will remain in history.`);
    if (!confirmed) return;
    setRestoringVersion(version);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/workflows/${workflowId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not restore this version.");
      await loadWorkflow();
      setNotice(`Restored version ${result.restored_from} as new version ${result.version}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not restore this version.");
    } finally {
      setRestoringVersion(null);
    }
  }

  async function validateDraft() {
    if (validating || saving || restoringVersion !== null) return;
    setValidating(true);
    setError("");
    setValidation(null);
    try {
      const response = await fetch(`/api/workflows/${workflowId}/definition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ definition }),
      });
      const result = await response.json();
      if (!response.ok) {
        setValidation({ valid: false, message: result.error || "This draft needs attention before it can pass validation.", checkedAt: new Date().toISOString() });
        return;
      }
      setValidation({ valid: true, message: "All configured steps passed the current draft checks. Nothing was saved or executed.", checkedAt: new Date().toISOString(), counts: result.counts });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not validate this draft.");
    } finally {
      setValidating(false);
    }
  }

  async function saveDefinition() {
    if (saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/workflows/${workflowId}/definition`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ definition }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save workflow steps.");
      setNotice(`Workflow saved as version ${result.version}.`);
      const versionsResponse = await fetch(`/api/workflows/${workflowId}/versions`, { cache: "no-store" });
      if (versionsResponse.ok) {
        const versionsResult = await versionsResponse.json();
        setVersions(Array.isArray(versionsResult.versions) ? versionsResult.versions : []);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save workflow steps.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <main className="builder-loading"><span className="builder-loader" />Loading workflow builder…</main>;
  if (error && !workflow) return <main className="builder-error"><span>!</span><h1>Couldn’t open this workflow</h1><p>{error}</p><Link href="/dashboard">Back to dashboard</Link></main>;

  return (
    <main className="builder-shell">
      <header className="builder-topbar">
        <Link href="/dashboard" className="builder-back">← <span>Dashboard</span></Link>
        <div className="builder-breadcrumb"><span>Workflows</span><b>/</b><strong>{workflow?.name ?? "Workflow builder"}</strong></div>
        <div className="builder-top-actions"><span className="builder-draft"><i /> {workflow?.status ?? "Draft"}</span><button className="builder-validate" onClick={() => void validateDraft()} disabled={validating || saving || restoringVersion !== null}>{validating ? "Checking…" : "Validate draft"}</button><button className="builder-save" onClick={() => void saveDefinition()} disabled={saving || validating || restoringVersion !== null}>{saving ? "Saving…" : restoringVersion !== null ? "Restoring…" : "Save workflow"} <span>↗</span></button></div>
      </header>

      <div className="builder-layout">
        <section className="builder-workspace">
          <div className="builder-heading"><div><div className="builder-eyebrow">WORKFLOW DESIGNER</div><h1>{workflow?.name ?? "Workflow builder"}</h1><p>{workflow?.description || "Connect steps into a clear, repeatable process."}</p></div><span className="builder-mode"><i /> Draft mode</span></div>
          {notice && <div className="builder-notice" role="status">{notice}</div>}
          {validation && <div className={`builder-validation ${validation.valid ? "validation-pass" : "validation-fail"}`} role="status"><span className="validation-mark">{validation.valid ? "✓" : "!"}</span><div><strong>{validation.valid ? "Draft checks passed" : "Draft needs attention"}</strong><p>{validation.message}</p>{validation.counts && <small>{validation.counts.triggers} trigger · {validation.counts.actions} actions · {validation.counts.conditions} conditions</small>}<small>Checked {new Date(validation.checkedAt).toLocaleTimeString()}</small></div></div>}
          {error && <div className="builder-error-banner" role="alert">{error}</div>}
          <div className="builder-canvas">
            <div className="canvas-grid" aria-hidden="true" />
            <div className="canvas-label"><span>CANVAS</span><span>{definition.nodes.length} / 30 steps</span></div>
            <div className="node-stack">
              {definition.nodes.map((node, index) => <div className="node-slot" key={node.id}>
                {index > 0 && <div className="node-connector"><span>↓</span></div>}
                <button className={`builder-node node-${node.type} ${selectedId === node.id ? "node-selected" : ""}`} onClick={() => setSelectedId(node.id)} aria-pressed={selectedId === node.id}>
                  <span className="node-icon">{nodeMeta[node.type].icon}</span><span className="node-copy"><small>{nodeMeta[node.type].label.toUpperCase()} · STEP {index + 1}</small><strong>{node.title}</strong><span>{node.description || nodeMeta[node.type].help}</span></span><span className="node-chevron">›</span>
                </button>
                {index === definition.nodes.length - 1 && <div className="node-endpoint"><span>＋</span> Add the next step from the panel</div>}
              </div>)}
              {definition.nodes.length === 0 && <div className="builder-empty"><span>✳</span><strong>Start with a trigger</strong><p>A trigger defines what starts your workflow.</p><button onClick={() => { const trigger = { ...starterDefinition.nodes[0], id: `trigger-${Date.now().toString(36)}`, settings: { event: "manual" } }; setDefinition({ version: 1, nodes: [trigger] }); setSelectedId(trigger.id); }}>Add trigger</button></div>}
            </div>
            <div className="canvas-footnote">This is a workflow draft. Steps are saved, but they do not execute yet.</div>
          </div>
        </section>

        <aside className="builder-panel">
          <div className="panel-header"><div><span className="panel-kicker">CONFIGURATION</span><h2>Step settings</h2></div><span className="panel-sliders">☷</span></div>
          {selectedNode ? <div className="panel-content">
            <div className={`selected-type type-${selectedNode.type}`}><span>{nodeMeta[selectedNode.type].icon}</span><div><strong>{nodeMeta[selectedNode.type].label}</strong><small>{nodeMeta[selectedNode.type].help}</small></div></div>
            <label htmlFor="step-title">Step name</label><input id="step-title" maxLength={80} value={selectedNode.title} onChange={(event) => updateSelected({ title: event.target.value })} />
            <label htmlFor="step-description">Description <span>Optional</span></label><textarea id="step-description" maxLength={240} rows={4} value={selectedNode.description} onChange={(event) => updateSelected({ description: event.target.value })} placeholder="Describe what this step should do…" />
            {selectedNode.type === "trigger" && <div className="step-config-fields">
              <div className="config-section-title">Trigger configuration</div>
              <label htmlFor="trigger-event">Start when</label>
              <select id="trigger-event" value={selectedNode.settings.event ?? "manual"} onChange={(event) => updateSetting("event", event.target.value)}>
                <option value="manual">Started manually</option><option value="schedule">On a schedule</option><option value="webhook">A webhook is received</option><option value="record_created">A new record is created</option>
              </select>
              <p className="config-note">This selects the intended start event. Scheduling, inbound webhooks and live triggers are not active yet.</p>
            </div>}
            {selectedNode.type === "action" && <div className="step-config-fields">
              <div className="config-section-title">Action configuration</div>
              <label htmlFor="action-provider">Service</label>
              <select id="action-provider" value={selectedNode.settings.provider ?? "internal"} onChange={(event) => { const provider = event.target.value; updateSetting("provider", provider); updateSetting("operation", provider === "email" ? "send_email" : provider === "slack" ? "send_message" : provider === "webhook" ? "http_request" : "create_task"); }}>
                <option value="internal">Aivanta task</option><option value="email">Email</option><option value="slack">Slack</option><option value="webhook">Webhook</option>
              </select>
              <label htmlFor="action-operation">Operation</label>
              <select id="action-operation" value={selectedNode.settings.operation ?? "create_task"} onChange={(event) => updateSetting("operation", event.target.value)}>
                {(selectedNode.settings.provider === "email" ? [{ value: "send_email", label: "Send an email" }] : selectedNode.settings.provider === "slack" ? [{ value: "send_message", label: "Send a message" }] : selectedNode.settings.provider === "webhook" ? [{ value: "http_request", label: "Send an HTTP request" }] : [{ value: "create_task", label: "Create a task" }]).map((operation) => <option key={operation.value} value={operation.value}>{operation.label}</option>)}
              </select>
              {(selectedNode.settings.operation === "send_email" || selectedNode.settings.operation === "send_message") && <>
                <label htmlFor="action-recipient">Recipient</label><input id="action-recipient" maxLength={240} value={selectedNode.settings.recipient ?? ""} onChange={(event) => updateSetting("recipient", event.target.value)} placeholder="name@example.com or channel" />
              </>}
              {selectedNode.settings.operation === "http_request" && <>
                <label htmlFor="action-url">Request URL</label><input id="action-url" maxLength={500} type="url" value={selectedNode.settings.url ?? ""} onChange={(event) => updateSetting("url", event.target.value)} placeholder="https://api.example.com/…" />
              </>}
              <label htmlFor="action-message">Payload / message <span>Optional</span></label>
              <textarea id="action-message" maxLength={500} rows={3} value={selectedNode.settings.message ?? ""} onChange={(event) => updateSetting("message", event.target.value)} placeholder="Describe the content or payload…" />
              <p className="config-note">Configuration is saved as a draft only. No service is contacted yet.</p>
            </div>}
            {selectedNode.type === "condition" && <div className="step-config-fields">
              <div className="config-section-title">Condition rules</div>
              <label htmlFor="condition-field">Field to check</label><input id="condition-field" maxLength={120} value={selectedNode.settings.field ?? ""} onChange={(event) => updateSetting("field", event.target.value)} placeholder="e.g. order.total" />
              <label htmlFor="condition-operator">Comparison</label>
              <select id="condition-operator" value={selectedNode.settings.operator ?? "equals"} onChange={(event) => updateSetting("operator", event.target.value)}>
                <option value="equals">Equals</option><option value="contains">Contains</option><option value="greater_than">Greater than</option><option value="less_than">Less than</option><option value="is_set">Is set</option>
              </select>
              {selectedNode.settings.operator !== "is_set" && <>
                <label htmlFor="condition-value">Expected value</label><input id="condition-value" maxLength={240} value={selectedNode.settings.value ?? ""} onChange={(event) => updateSetting("value", event.target.value)} placeholder="Value to compare against" />
              </>}
              <p className="config-note">Rules are stored in your draft. They will not be evaluated until execution is implemented.</p>
            </div>}
            <div className="panel-divider" />
            <div className="step-order"><span>Step order</span><div><button aria-label="Move step up" disabled={definition.nodes.findIndex((node) => node.id === selectedNode.id) <= 1} onClick={() => moveNode(definition.nodes.findIndex((node) => node.id === selectedNode.id), -1)}>↑</button><button aria-label="Move step down" disabled={definition.nodes.findIndex((node) => node.id === selectedNode.id) >= definition.nodes.length - 1} onClick={() => moveNode(definition.nodes.findIndex((node) => node.id === selectedNode.id), 1)}>↓</button></div></div>
            {selectedNode.type !== "trigger" && <button className="remove-step" onClick={removeSelected}>Remove this step</button>}
          </div> : <div className="panel-empty">Select a step on the canvas to edit its settings.</div>}
          <div className="panel-add"><div className="panel-add-heading"><strong>Add a step</strong><span>Choose what happens next</span></div><button onClick={() => addNode("action")} disabled={definition.nodes.length >= 30}><span className="add-icon action-add">↗</span><span><strong>Action</strong><small>Perform a task</small></span><b>＋</b></button><button onClick={() => addNode("condition")} disabled={definition.nodes.length >= 30}><span className="add-icon condition-add">◇</span><span><strong>Condition</strong><small>Check a rule</small></span><b>＋</b></button><p>Triggers, integrations and live execution will be connected in a later release.</p></div>
          <section className="version-history" aria-labelledby="version-history-title">
            <div className="panel-add-heading"><strong id="version-history-title">Version history</strong><span>Last 10 saved versions</span></div>
            {versions.length ? <ol>{versions.map((item, index) => <li key={item.version} className={index === 0 ? "version-latest" : ""}><span><strong>Version {item.version}</strong>{index === 0 && <small>Latest</small>}<time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time></span><button type="button" className="version-restore" onClick={() => void restoreVersion(item.version)} disabled={saving || restoringVersion !== null || index === 0} aria-label={`Restore version ${item.version}`}>{restoringVersion === item.version ? "Restoring…" : index === 0 ? "Current" : "Restore"}</button></li>)}</ol> : <p className="version-empty">Your saved versions will appear here after the first save.</p>}
            <p className="version-footnote">Restoring creates a new version, so your history stays intact.</p>
          </section>
        </aside>
      </div>
    </main>
  );
}
