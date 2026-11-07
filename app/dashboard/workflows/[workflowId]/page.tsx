"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import "./builder.css";
import RunTestPanel from "./run-test-panel";

type NodeType = "trigger" | "action" | "condition";
type WorkflowNode = { id: string; type: NodeType; title: string; description: string; settings: Record<string, string>; position?: { x: number; y: number } };
type WorkflowEdge = { id: string; source: string; target: string; label: "true" | "false" | "next" };
type Definition = { version: 1; nodes: WorkflowNode[]; edges?: WorkflowEdge[] };
type Workflow = { id: string; name: string; description: string; status: string };
type WorkflowVersion = { version: number; created_at: string };

const starterDefinition: Definition = { version: 1, edges: [], nodes: [
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
  const [workflow, setWorkflow] = useState<Workflow | null>(null);\n  const [registryCatalog, setRegistryCatalog] = useState<RegistryCatalog[]>([]);
  const [definition, setDefinition] = useState<Definition>(starterDefinition);
  const [savedFingerprint, setSavedFingerprint] = useState(JSON.stringify(starterDefinition));
  const [selectedId, setSelectedId] = useState("trigger-1");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [versions, setVersions] = useState<WorkflowVersion[]>([]);
  const [restoringVersion, setRestoringVersion] = useState<number | null>(null);
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<{ valid: boolean; message: string; checkedAt: string; counts?: { triggers: number; actions: number; conditions: number } } | null>(null);
  const draftRevision = useRef(0);
  const graphCanvasRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ id: string; pointerId: number; startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [connectionLabel, setConnectionLabel] = useState<"true" | "false" | "next">("next");

  const selectedNode = definition.nodes.find((node) => node.id === selectedId) ?? definition.nodes[0] ?? null;
  const isDirty = JSON.stringify(definition) !== savedFingerprint;
  const isCommentToDm = /comment to dm/i.test(workflow?.name ?? "");
  const isLeadFollowUp = /lead follow-up/i.test(workflow?.name ?? "");
  const isLeadAlert = /new lead alert/i.test(workflow?.name ?? "");
  const isFormToLead = /form to lead/i.test(workflow?.name ?? "");
  const isSupportTriage = /support ticket triage/i.test(workflow?.name ?? "");
  const isContentApproval = /content approval/i.test(workflow?.name ?? "");

  useEffect(() => {
    if (!isDirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [isDirty]);

  const loadWorkflow = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/workflows/${workflowId}/definition`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load this workflow.");
      setWorkflow(result.workflow);\n      const catalogResponse = await fetch("/api/node-catalog", { cache: "no-store" });\n      if (catalogResponse.ok) { const catalogResult = await catalogResponse.json(); setRegistryCatalog(Array.isArray(catalogResult.nodes) ? catalogResult.nodes : []); }
      const nextDefinition = result.definition as Definition;
      setDefinition({ ...nextDefinition, edges: nextDefinition.edges ?? nextDefinition.nodes.slice(1).map((node, index) => ({ id: `edge-${index + 1}`, source: nextDefinition.nodes[index].id, target: node.id, label: "next" as const })) });
      setSavedFingerprint(JSON.stringify({ ...nextDefinition, edges: nextDefinition.edges ?? nextDefinition.nodes.slice(1).map((node, index) => ({ id: `edge-${index + 1}`, source: nextDefinition.nodes[index].id, target: node.id, label: "next" as const })) }));
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

  function nodePosition(node: WorkflowNode, index: number) {
    if (node.position) return node.position;
    const incomingBranch = (definition.edges ?? []).find((edge) => edge.target === node.id && edge.label !== "next");
    const col = incomingBranch?.label === "false" ? 2 : incomingBranch?.label === "true" ? 0 : index % 3;
    return { x: 170 + col * 300, y: 90 + Math.floor(index / 3) * 210 };
  }

  function updateNodePosition(id: string, x: number, y: number) {
    draftRevision.current += 1;
    setValidation(null);
    setDefinition((current) => ({ ...current, nodes: current.nodes.map((node) => node.id === id ? { ...node, position: { x: Math.max(120, Math.min(1900, x)), y: Math.max(70, Math.min(1800, y)) } } : node) }));
  }

  function beginNodeDrag(event: ReactPointerEvent<HTMLDivElement>, node: WorkflowNode, index: number) {
    if ((event.target as HTMLElement).closest("button")) return;
    const point = nodePosition(node, index);
    dragState.current = { id: node.id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: point.x, originY: point.y, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveNodeDrag(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragState.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    updateNodePosition(drag.id, drag.originX + dx, drag.originY + dy);
  }

  function endNodeDrag(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragState.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.moved) setSelectedId(drag.id);
    else setNotice("Node position updated. Save your changes to keep this layout.");
    dragState.current = null;
  }

  function connectNodes(source: string, target: string, label: "true" | "false" | "next") {
    if (source === target) return;
    const duplicate = (definition.edges ?? []).some((edge) => edge.source === source && edge.target === target);
    if (duplicate) { setNotice("Those nodes are already connected."); setConnectingFrom(null); return; }
    const sourceNode = definition.nodes.find((node) => node.id === source);
    if (!sourceNode || (label !== "next" && sourceNode.type !== "condition")) return;
    draftRevision.current += 1;
    setValidation(null);
    setDefinition((current) => ({
      ...current,
      nodes: current.nodes.map((node) => node.id !== target || label === "next" ? node : {
        ...node,
        position: { x: label === "true" ? 170 : 770, y: Math.min(1800, node.position?.y ?? 90 + Math.floor(current.nodes.findIndex((item) => item.id === node.id) / 3) * 210) },
      }),
      edges: [...(current.edges ?? []), { id: `edge-${Date.now().toString(36)}`, source, target, label }],
    }));
    setConnectingFrom(null);
    setNotice("Connection added. Save your changes when ready.");
  }

  function updateSelected(updates: Partial<Pick<WorkflowNode, "title" | "description">>) {
    if (!selectedNode) return;
    draftRevision.current += 1;
    setValidation(null);
    setDefinition((current) => ({ ...current, nodes: current.nodes.map((node) => node.id === selectedNode.id ? { ...node, ...updates } : node) }));
  }

  function updateSetting(key: string, value: string) {
    if (!selectedNode) return;
    draftRevision.current += 1;
    setValidation(null);
    setDefinition((current) => ({
      ...current,
      nodes: current.nodes.map((node) => node.id === selectedNode.id
        ? { ...node, settings: { ...node.settings, [key]: value } }
        : node),
    }));
  }

  async function generateDraftOnCanvas() {
    const prompt = window.prompt("Describe the workflow to draft:");
    if (!prompt?.trim()) return;
    setError(""); setNotice("Generating a reviewable draft…");
    try {
      const response = await fetch("/api/ai/generate-workflow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) });
      const payload = await response.json();
      if (!response.ok || !payload.definition?.nodes?.length) throw new Error(payload.error || "AI could not create a draft.");
      const generated = payload.definition as Definition;
      const normalized = { ...generated, edges: generated.edges ?? generated.nodes.slice(1).map((node, index) => ({ id: "ai-edge-" + index, source: generated.nodes[index].id, target: node.id, label: "next" as const })) };
      draftRevision.current += 1; setValidation(null); setDefinition(normalized); setSelectedId(normalized.nodes[0]?.id ?? "");
      setNotice("AI draft loaded onto the canvas. Review and edit it, then Save workflow; it has not been executed.");
    } catch (e) { setError(e instanceof Error ? e.message : "AI draft generation failed."); setNotice(""); }
  }

  function addNode(type: Exclude<NodeType, "trigger">) {
    draftRevision.current += 1;
    setValidation(null);
    const id = `${type}-${Date.now().toString(36)}`;
    const node: WorkflowNode = {
      id, type, title: type === "action" ? "New action" : "Check a condition", description: "",
      settings: type === "action"
        ? { provider: "internal", operation: "create_task", recipient: "", message: "", url: "" }
        : { field: "", operator: "equals", value: "" },
    };
    setDefinition((current) => { const previous = current.nodes[current.nodes.length - 1]; return { ...current, nodes: [...current.nodes, node], edges: [...(current.edges ?? []), ...(previous ? [{ id: `edge-${previous.id}-${id}`, source: previous.id, target: id, label: "next" as const }] : [])] }; });
    setSelectedId(id);
    setNotice("Step added. Save your changes when you're ready.");
  }

  function removeSelected() {
    if (!selectedNode || selectedNode.type === "trigger") return;
    draftRevision.current += 1;
    setValidation(null);
    setDefinition((current) => { const nodes = current.nodes.filter((node) => node.id !== selectedNode.id); const edges = (current.edges ?? []).filter((edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id); return { ...current, nodes, edges }; });
    setSelectedId(definition.nodes.find((node) => node.type === "trigger")?.id ?? "");
    setNotice("Step removed. Save your changes to keep this update.");
  }

  function moveNode(index: number, direction: -1 | 1) {
    draftRevision.current += 1;
    setValidation(null);
    const target = index + direction;
    if (target < 1 || target >= definition.nodes.length) return;
    setDefinition((current) => {
      const nodes = [...current.nodes];
      [nodes[index], nodes[target]] = [nodes[target], nodes[index]];
      return { ...current, nodes };
    });
  }

  async function restoreVersion(version: number) {
    if (saving || validating || restoringVersion !== null) return;
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
    const revisionAtStart = draftRevision.current;
    try {
      const response = await fetch(`/api/workflows/${workflowId}/definition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ definition }),
      });
      const result = await response.json();
      if (revisionAtStart !== draftRevision.current) return;
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
    if (saving || validating || restoringVersion !== null) return;
    setValidation(null);
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/workflows/${workflowId}/definition`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ definition, registrySteps: definition.nodes.filter((node) => node.type === "trigger" || node.type === "action").map((node) => ({ id: node.id, nodeId: node.type === "trigger" ? "manual" : node.settings.provider === "email" ? "email" : node.settings.provider === "slack" ? "slack" : node.settings.provider === "openai" ? "openai" : "internal", operationId: node.type === "trigger" ? "start" : node.settings.provider === "email" ? "send_email" : node.settings.provider === "slack" ? "send_message" : node.settings.provider === "openai" ? "generate_text" : "create_task", kind: node.type === "trigger" ? "trigger" : "action", input: node.type === "trigger" ? {} : node.settings.provider === "email" ? { to: node.settings.recipient ?? "", subject: node.title, text: node.settings.message ?? node.title } : node.settings.provider === "slack" ? { message: node.settings.message ?? node.title } : node.settings.provider === "openai" ? { prompt: node.settings.message ?? node.title } : { message: node.settings.message ?? node.title } })) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save workflow steps.");
      setSavedFingerprint(JSON.stringify(definition));
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
      <aside className="workflow-side-nav">
        <Link className="workflow-side-brand" href="/"><span><img src="/aivanta-mark.svg" alt="" aria-hidden="true"/></span>Aivanta</Link>
        <div className="workflow-side-label">WORKSPACE</div>
        <Link className="workflow-side-link" href="/dashboard"><span>▦</span>Dashboard</Link>
        <Link className="workflow-side-link active" href="/dashboard#workflows"><span>↗</span>Workflows</Link>
        <Link className="workflow-side-link" href="/dashboard/integrations"><span>⌘</span>Integrations</Link>
        <Link className="workflow-side-link" href="/dashboard/ai-assistant"><span>✺</span>AI Agents</Link>
        <Link className="workflow-side-link" href="/dashboard/templates"><span>▧</span>Templates</Link>
        <Link className="workflow-side-link" href="/dashboard/analytics"><span>▥</span>Analytics</Link>
        <Link className="workflow-side-link" href="/dashboard/activity"><span>◷</span>Activity logs</Link>
        <Link className="workflow-side-link" href="/dashboard/settings"><span>⚙</span>Settings</Link>
        <div className="workflow-side-bottom"><span className="workflow-workspace-avatar">A</span><div><strong>Your workspace</strong><small>Draft mode</small></div></div>
      </aside>
      <section className="workflow-builder-main">
      <header className="builder-topbar">
        <Link href="/dashboard" className="builder-back" onClick={(event) => { if (isDirty && !window.confirm("You have unsaved workflow changes. Leave this page and discard them?")) event.preventDefault(); }}>← <span>Dashboard</span></Link>
        <div className="builder-breadcrumb"><span>Workflows</span><b>/</b><strong>{workflow?.name ?? "Workflow builder"}</strong></div>
        <div className="builder-top-actions"><a className="builder-test-link" href="#workflow-test-panel">Test workflow ↓</a><span className={`builder-draft ${isDirty ? "builder-draft-dirty" : ""}`}><i /> {isDirty ? "Unsaved changes" : workflow?.status ?? "Draft"}</span><button className="builder-validate" onClick={() => void generateDraftOnCanvas()} disabled={saving || validating}>AI draft</button><button className="builder-validate" onClick={() => void validateDraft()} disabled={validating || saving || restoringVersion !== null}>{validating ? "Checking…" : "Validate draft"}</button><button className="builder-save" onClick={() => void saveDefinition()} disabled={saving || validating || restoringVersion !== null}>{saving ? "Saving…" : restoringVersion !== null ? "Restoring…" : "Save workflow"} <span>↗</span></button></div>
      </header>

      <div className="builder-layout">
        <section className="builder-workspace">
          <div className="builder-heading"><div><div className="builder-eyebrow">WORKFLOW DESIGNER</div><h1>{workflow?.name ?? "Workflow builder"}</h1><p>{workflow?.description || "Connect steps into a clear, repeatable process."}</p><a className="builder-test-link builder-test-link-prominent" href="#workflow-test-panel">↓ Find safe test panel</a></div><span className="builder-mode"><i /> Draft mode</span></div>
          {notice && <div className="builder-notice" role="status">{notice}</div>}
          {validation && <div className={`builder-validation ${validation.valid ? "validation-pass" : "validation-fail"}`} role="status"><span className="validation-mark">{validation.valid ? "✓" : "!"}</span><div><strong>{validation.valid ? "Draft checks passed" : "Draft needs attention"}</strong><p>{validation.message}</p>{validation.counts && <small>{validation.counts.triggers} trigger · {validation.counts.actions} actions · {validation.counts.conditions} conditions</small>}<small>Checked {new Date(validation.checkedAt).toLocaleTimeString()}</small></div></div>}
          {error && <div className="builder-error-banner" role="alert">{error}</div>}
          <RunTestPanel
            workflowId={workflowId}
            hasUnsavedChanges={isDirty}
            workflowStatus={workflow?.status ?? "draft"}
            liveEmailRecipient={definition.nodes.find((node) => node.type === "action" && node.settings.provider === "email" && node.settings.operation === "send_email")?.settings.recipient ?? ""}
          />
          <div className="builder-canvas">
            <div className="canvas-grid" aria-hidden="true" />
            <div className="canvas-label"><span>CANVAS · DRAG NODES TO REPOSITION</span><span>{definition.nodes.length} / 30 steps</span></div>
            <div className="graph-canvas" role="region" aria-label="Workflow graph canvas">
              <div className="graph-grid" aria-hidden="true" />
              <div className="graph-layout" ref={graphCanvasRef} style={{ height: Math.max(680, ...definition.nodes.map((node, index) => nodePosition(node, index).y + 180)) }}>
                <svg className="graph-edges" aria-hidden="true"><defs><marker id="graph-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="#9ab78a" /></marker></defs>
                  {(definition.edges ?? []).map((edge) => {
                    const sourceIndex = definition.nodes.findIndex((node) => node.id === edge.source);
                    const targetIndex = definition.nodes.findIndex((node) => node.id === edge.target);
                    if (sourceIndex < 0 || targetIndex < 0) return null;
                    const source = nodePosition(definition.nodes[sourceIndex], sourceIndex);
                    const target = nodePosition(definition.nodes[targetIndex], targetIndex);
                    const sx = source.x + 105, sy = source.y + 62, tx = target.x + 105, ty = target.y + 62;
                    const curve = Math.max(45, Math.abs(tx - sx) * .45);
                    return <g key={edge.id} className={`graph-edge graph-edge-${edge.label}`}><path d={`M ${sx} ${sy} C ${sx + curve} ${sy}, ${tx - curve} ${ty}, ${tx} ${ty}`} /><text x={(sx + tx) / 2} y={(sy + ty) / 2 - 12}>{edge.label === "next" ? "" : edge.label.toUpperCase()}</text></g>;
                  })}
                </svg>
                {definition.nodes.map((node, index) => {
                  const point = nodePosition(node, index);
                  return <div key={node.id} className={`graph-node graph-node-${node.type} ${selectedId === node.id ? "graph-node-selected" : ""} ${connectingFrom === node.id ? "graph-node-connecting" : ""}`} style={{ left: point.x, top: point.y }} onPointerDown={(event) => beginNodeDrag(event, node, index)} onPointerMove={moveNodeDrag} onPointerUp={endNodeDrag} onPointerCancel={() => { dragState.current = null; }} role="group" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedId(node.id); } }} aria-label={`Select and drag ${node.title}`}>
                    <button type="button" className="graph-node-port graph-port-in" aria-label={`Connect into ${node.title}`} title={connectingFrom ? "Complete connection" : "Choose a source node"} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); if (!connectingFrom) { setNotice("Choose an output handle first."); return; } connectNodes(connectingFrom, node.id, connectionLabel); }} />
                    <span className="graph-node-icon">{nodeMeta[node.type].icon}</span><span className="graph-node-kind">{nodeMeta[node.type].label} · {index + 1}</span><strong>{node.title}</strong><small>{node.description || nodeMeta[node.type].help}</small>
                    <button type="button" className="graph-node-port graph-port-out" aria-label={`Connect from ${node.title}`} title="Start a connection" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setSelectedId(node.id); setConnectingFrom(node.id); setNotice(node.type === "condition" ? "Choose True or False in the connection editor, then select a destination input handle." : "Select a destination input handle."); }} />
                  </div>;
                })}
                {definition.nodes.length === 0 && <div className="builder-empty"><strong>Start with a trigger</strong><button onClick={() => { const trigger = { ...starterDefinition.nodes[0], id: `trigger-${Date.now().toString(36)}` }; setDefinition({ version: 1, nodes: [trigger], edges: [] }); setSelectedId(trigger.id); }}>Add trigger</button></div>}
              </div>
            </div>
            <div className="canvas-footnote">Use the safe test panel to evaluate conditions and inspect simulated step results. External actions remain disabled.</div>
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
              <label htmlFor="trigger-event">{isCommentToDm ? "When a comment arrives" : isLeadFollowUp || isLeadAlert ? "When a new lead arrives" : isFormToLead ? "When a form is submitted" : isSupportTriage ? "When a support request arrives" : isContentApproval ? "When a draft is submitted" : "Start when"}</label>
              <select id="trigger-event" value={selectedNode.settings.event ?? "manual"} onChange={(event) => updateSetting("event", event.target.value)}>
                <option value="manual">Started manually</option><option value="schedule">On a schedule</option><option value="webhook">A webhook is received</option><option value="record_created">A new record is created</option>
              </select>
              {(isLeadFollowUp || isLeadAlert || isFormToLead) && <><label htmlFor="trigger-source">Lead source</label><input id="trigger-source" maxLength={120} value={selectedNode.settings.source ?? ""} onChange={(event) => updateSetting("source", event.target.value)} placeholder="Website form, Instagram, CRM…" /><p className="config-note">Saved as draft context; the source is not connected automatically yet.</p></>}
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
              {isCommentToDm && <><label htmlFor="action-guide-url">Guide link</label><input id="action-guide-url" type="url" maxLength={500} value={selectedNode.settings.url ?? ""} onChange={(event) => updateSetting("url", event.target.value)} placeholder="https://your-site.com/guide" /></>}
              <label htmlFor="action-message">{isCommentToDm ? "DM message" : isLeadFollowUp ? "Follow-up task notes" : isLeadAlert ? "Lead alert details" : isFormToLead ? "Lead review notes" : isSupportTriage ? "Support task details" : isContentApproval ? "Review task details" : "Payload / message"} <span>Optional</span></label>
              <textarea id="action-message" maxLength={500} rows={3} value={selectedNode.settings.message ?? ""} onChange={(event) => updateSetting("message", event.target.value)} placeholder={isCommentToDm ? "Thanks for commenting! Here is your guide:" : isLeadFollowUp ? "Follow up with {{lead_name}} about {{interest}}." : isLeadAlert ? "Review new lead {{lead_name}} from {{source}}." : isFormToLead ? "Qualify {{name}} using the submitted details." : isSupportTriage ? "Review {{customer_name}}’s request: {{subject}}." : isContentApproval ? "Review the draft: {{content_title}}." : "Describe the content or payload…"} />
              {isLeadFollowUp && <><label htmlFor="follow-up-delay">Follow-up delay</label><select id="follow-up-delay" value={selectedNode.settings.delay ?? "immediate"} onChange={(event) => updateSetting("delay", event.target.value)}><option value="immediate">Immediately</option><option value="15_minutes">After 15 minutes</option><option value="1_hour">After 1 hour</option><option value="1_day">After 1 day</option></select><p className="config-note">Delay is saved as a draft setting. Scheduled waiting is not active yet.</p></>}
              <p className="config-note">Configuration is saved as a draft only. No service is contacted yet.</p>
            </div>}
            {selectedNode.type === "condition" && <div className="step-config-fields">
              <div className="config-section-title">Condition rules</div>
              <label htmlFor="condition-field">{isCommentToDm ? "Comment text" : isLeadFollowUp ? "Lead follow-up status" : isSupportTriage ? "Ticket priority" : isContentApproval ? "Approval status" : "Field to check"}</label><input id="condition-field" maxLength={120} value={selectedNode.settings.field ?? ""} onChange={(event) => updateSetting("field", event.target.value)} placeholder={isCommentToDm ? "comment_text" : isLeadFollowUp ? "follow_up_status" : isSupportTriage ? "priority" : isContentApproval ? "approval_status" : "e.g. order.total"} />
              <label htmlFor="condition-operator">Comparison</label>
              <select id="condition-operator" value={selectedNode.settings.operator ?? "equals"} onChange={(event) => updateSetting("operator", event.target.value)}>
                <option value="equals">Equals</option><option value="contains">Contains</option><option value="greater_than">Greater than</option><option value="less_than">Less than</option><option value="is_set">Is set</option>
              </select>
              {selectedNode.settings.operator !== "is_set" && <>
                <label htmlFor="condition-value">{isCommentToDm ? "Keyword to match" : isLeadFollowUp ? "Status to match" : isSupportTriage ? "Urgency to match" : isContentApproval ? "Approval status to match" : "Expected value"}</label><input id="condition-value" maxLength={240} value={selectedNode.settings.value ?? ""} onChange={(event) => updateSetting("value", event.target.value)} placeholder={isCommentToDm ? "guide" : isLeadFollowUp ? "pending" : isSupportTriage ? "urgent" : isContentApproval ? "pending" : "Value to compare against"} />
              </>}
              <p className="config-note">Rules are stored in your draft. They will not be evaluated until execution is implemented.</p>
            </div>}
            <div className="panel-divider" />
            <section className="graph-connection-editor" aria-label="Node connections">
              <div className="config-section-title">Connections</div>
              <p className="config-note">Connect this node to another node. Conditions can create true and false paths.</p>
              {(definition.edges ?? []).filter((edge) => edge.source === selectedNode.id || edge.target === selectedNode.id).map((edge) => <div className="graph-edge-row" key={edge.id}><span><b>{edge.label === "next" ? "Next" : edge.label.toUpperCase()}</b> · {definition.nodes.find((node) => node.id === edge.source)?.title} → {definition.nodes.find((node) => node.id === edge.target)?.title}</span><button type="button" aria-label="Remove connection" onClick={() => { draftRevision.current += 1; setValidation(null); setDefinition((current) => ({ ...current, edges: (current.edges ?? []).filter((item) => item.id !== edge.id) })); }}>×</button></div>)}
              {selectedNode.type === "condition" && <><label htmlFor="connection-branch">Branch label</label><select id="connection-branch" value={connectionLabel} onChange={(event) => setConnectionLabel(event.target.value as "true" | "false" | "next")}><option value="true">True path</option><option value="false">False path</option></select></>}
              <button type="button" className="builder-validate" onClick={() => { setConnectingFrom(selectedNode.id); setConnectionLabel(selectedNode.type === "condition" ? connectionLabel : "next"); setNotice("Select an input handle on the destination node."); }}>Start connection from this node</button>
              <label htmlFor="connect-target">Connect to node</label>
              <select id="connect-target" defaultValue="" onChange={(event) => { const target = event.target.value; if (target) connectNodes(selectedNode.id, target, selectedNode.type === "condition" ? connectionLabel : "next"); event.currentTarget.value = ""; }}>
                <option value="">Choose destination…</option>{definition.nodes.filter((node) => node.id !== selectedNode.id).map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}
              </select>
            </section>
            <div className="panel-divider" />
            <div className="step-order"><span>Step order</span><div><button aria-label="Move step up" disabled={definition.nodes.findIndex((node) => node.id === selectedNode.id) <= 1} onClick={() => moveNode(definition.nodes.findIndex((node) => node.id === selectedNode.id), -1)}>↑</button><button aria-label="Move step down" disabled={definition.nodes.findIndex((node) => node.id === selectedNode.id) >= definition.nodes.length - 1} onClick={() => moveNode(definition.nodes.findIndex((node) => node.id === selectedNode.id), 1)}>↓</button></div></div>
            {selectedNode.type !== "trigger" && <button className="remove-step" onClick={removeSelected}>Remove this step</button>}
          </div> : <div className="panel-empty">Select a step on the canvas to edit its settings.</div>}
          <div className="panel-add"><div className="panel-add-heading"><strong>Add a step</strong><span>Choose what happens next</span></div><button onClick={() => addNode("action")} disabled={definition.nodes.length >= 30}><span className="add-icon action-add">↗</span><span><strong>Action</strong><small>Perform a task</small></span><b>＋</b></button><button onClick={() => addNode("condition")} disabled={definition.nodes.length >= 30}><span className="add-icon condition-add">◇</span><span><strong>Condition</strong><small>Check a rule</small></span><b>＋</b></button><p>Triggers, integrations and live execution will be connected in a later release.</p></div>
          <section className="version-history" aria-labelledby="version-history-title">
            <div className="panel-add-heading"><strong id="version-history-title">Version history</strong><span>Last 10 saved versions</span></div>
            {versions.length ? <ol>{versions.map((item, index) => <li key={item.version} className={index === 0 ? "version-latest" : ""}><span><strong>Version {item.version}</strong>{index === 0 && <small>Latest</small>}<time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time></span><button type="button" className="version-restore" onClick={() => void restoreVersion(item.version)} disabled={saving || validating || restoringVersion !== null || index === 0} aria-label={`Restore version ${item.version}`}>{restoringVersion === item.version ? "Restoring…" : index === 0 ? "Current" : "Restore"}</button></li>)}</ol> : <p className="version-empty">Your saved versions will appear here after the first save.</p>}
            <p className="version-footnote">Restoring creates a new version, so your history stays intact.</p>
          </section>
        </aside>
      </div>
      </section>
    </main>
  );
}
