"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import "./builder.css";

type NodeType = "trigger" | "action" | "condition";
type WorkflowNode = { id: string; type: NodeType; title: string; description: string };
type Definition = { version: 1; nodes: WorkflowNode[] };
type Workflow = { id: string; name: string; description: string; status: string };

const starterDefinition: Definition = { version: 1, nodes: [
  { id: "trigger-1", type: "trigger", title: "When this happens", description: "Choose an event that starts your workflow." },
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

  function addNode(type: Exclude<NodeType, "trigger">) {
    const id = `${type}-${Date.now().toString(36)}`;
    const node: WorkflowNode = { id, type, title: type === "action" ? "New action" : "Check a condition", description: "" };
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
      setNotice("Workflow steps saved to your Aivanta workspace.");
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
        <div className="builder-top-actions"><span className="builder-draft"><i /> {workflow?.status ?? "Draft"}</span><button className="builder-save" onClick={() => void saveDefinition()} disabled={saving}>{saving ? "Saving…" : "Save workflow"} <span>↗</span></button></div>
      </header>

      <div className="builder-layout">
        <section className="builder-workspace">
          <div className="builder-heading"><div><div className="builder-eyebrow">WORKFLOW DESIGNER</div><h1>{workflow?.name ?? "Workflow builder"}</h1><p>{workflow?.description || "Connect steps into a clear, repeatable process."}</p></div><span className="builder-mode"><i /> Draft mode</span></div>
          {notice && <div className="builder-notice" role="status">{notice}</div>}
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
              {definition.nodes.length === 0 && <div className="builder-empty"><span>✳</span><strong>Start with a trigger</strong><p>A trigger defines what starts your workflow.</p><button onClick={() => { const trigger = { ...starterDefinition.nodes[0], id: `trigger-${Date.now().toString(36)}` }; setDefinition({ version: 1, nodes: [trigger] }); setSelectedId(trigger.id); }}>Add trigger</button></div>}
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
            <div className="panel-divider" />
            <div className="step-order"><span>Step order</span><div><button aria-label="Move step up" disabled={definition.nodes.findIndex((node) => node.id === selectedNode.id) <= 1} onClick={() => moveNode(definition.nodes.findIndex((node) => node.id === selectedNode.id), -1)}>↑</button><button aria-label="Move step down" disabled={definition.nodes.findIndex((node) => node.id === selectedNode.id) >= definition.nodes.length - 1} onClick={() => moveNode(definition.nodes.findIndex((node) => node.id === selectedNode.id), 1)}>↓</button></div></div>
            {selectedNode.type !== "trigger" && <button className="remove-step" onClick={removeSelected}>Remove this step</button>}
          </div> : <div className="panel-empty">Select a step on the canvas to edit its settings.</div>}
          <div className="panel-add"><div className="panel-add-heading"><strong>Add a step</strong><span>Choose what happens next</span></div><button onClick={() => addNode("action")} disabled={definition.nodes.length >= 30}><span className="add-icon action-add">↗</span><span><strong>Action</strong><small>Perform a task</small></span><b>＋</b></button><button onClick={() => addNode("condition")} disabled={definition.nodes.length >= 30}><span className="add-icon condition-add">◇</span><span><strong>Condition</strong><small>Check a rule</small></span><b>＋</b></button><p>Triggers, integrations and live execution will be connected in a later release.</p></div>
        </aside>
      </div>
    </main>
  );
}
