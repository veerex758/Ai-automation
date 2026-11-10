"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import "./builder.css";
import RunTestPanel from "./run-test-panel";
import RegistryOperationSettings from "./registry-operation-settings";
import { buildRegistrySteps } from "@/lib/workflows/build-registry-steps";
type RegistryCatalog = { id: string; name: string; icon?: string; category?: string; triggers: { id: string; name: string; description: string; inputSchema: { properties?: Record<string, { type?: string; title?: string; description?: string; enum?: unknown[]; default?: unknown }>; required?: string[] } }[]; actions: { id: string; name: string; description: string; inputSchema: { properties?: Record<string, { type?: string; title?: string; description?: string; enum?: unknown[]; default?: unknown }>; required?: string[] } }[] };

type NodeType = "trigger" | "action" | "condition";
type WorkflowNode = { id: string; type: NodeType; title: string; description: string; settings: Record<string, string>; registryNodeId?: string; registryOperationId?: string; registryInput?: Record<string, unknown>; position?: { x: number; y: number } };
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
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [registryCatalog, setRegistryCatalog] = useState<RegistryCatalog[]>([]);
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
      setWorkflow(result.workflow);
      const catalogResponse = await fetch("/api/workflows/actions", { cache: "no-store" });
      if (catalogResponse.ok) { const catalogResult = await catalogResponse.json(); setRegistryCatalog(Array.isArray(catalogResult.registryNodes) ? catalogResult.registryNodes : []); }
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
    const duplicate = (definition.edges ?? []).some((edge) => edge.source === source && edge.target === target && edge.label === label);
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

  function addRegisteredNode(kind: "trigger" | "action", nodeId: string) {
    if (definition.nodes.length >= 30) return;
    const registryNode = registryCatalog.find((item) => item.id === nodeId);
    const operation = (kind === "trigger" ? registryNode?.triggers : registryNode?.actions)?.[0];
    if (!registryNode || !operation) {
      setNotice("That catalogue entry has no registered operation available.");
      return;
    }
    if (kind === "trigger" && definition.nodes.some((node) => node.type === "trigger")) {
      setNotice("A workflow can have only one trigger. Edit the existing trigger instead.");
      return;
    }
    const id = `${kind}-${Date.now().toString(36)}`;
    const input = Object.fromEntries(Object.entries(operation.inputSchema.properties ?? {}).map(([key, field]) => [key, field.default ?? ""]));
    const node: WorkflowNode = {
      id, type: kind, title: operation.name || registryNode.name,
      description: operation.description || registryNode.name,
      settings: { provider: nodeId, operation: operation.id },
      registryNodeId: nodeId, registryOperationId: operation.id, registryInput: input,
    };
    draftRevision.current += 1;
    setValidation(null);
    setDefinition((current) => {
      const previous = kind === "action" ? current.nodes[current.nodes.length - 1] : undefined;
      return {
        ...current,
        nodes: [...current.nodes, node],
        edges: [...(current.edges ?? []), ...(previous ? [{ id: `edge-${previous.id}-${id}`, source: previous.id, target: id, label: "next" as const }] : [])],
      };
    });
    setSelectedId(id);
    setNotice(`${registryNode.name} · ${operation.name} added to the draft. Configure it, then save.`);
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
        body: JSON.stringify({
          definition: { ...definition, nodes: definition.nodes.map((node) => ({ ...node, settings: node.type === "trigger" ? { event: "manual" } : node.type === "action" && node.registryNodeId ? { provider: "internal", operation: "create_task" } : node.settings })) },
          registrySteps: buildRegistrySteps(definition),
        }),
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
              <div className="graph-layout" ref={graphCanvasRef} style={{ width: Math.max(1000, ...definition.nodes.map((node, index) => nodePosition(node, index).x + 190)), height: Math.max(680, ...definition.nodes.map((node, index) => nodePosition(node, index).y + 180)) }}>
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
            {selectedNode.type === "trigger" && <RegistryOperationSettings catalog={registryCatalog} kind="trigger" nodeId={selectedNode.registryNodeId ?? "manual"} operationId={selectedNode.registryOperationId ?? "start"} input={selectedNode.registryInput ?? {}} onChange={(nodeId, operationId, input) => { draftRevision.current += 1; setValidation(null); setDefinition((current) => ({ ...current, nodes: current.nodes.map((node) => node.id === selectedNode.id ? { ...node, registryNodeId: nodeId, registryOperationId: operationId, registryInput: input, settings: { ...node.settings, provider: nodeId, operation: operationId } } : node) })); }} />}
            {selectedNode.type === "action" && <RegistryOperationSettings catalog={registryCatalog} kind="action" nodeId={selectedNode.registryNodeId ?? (selectedNode.settings.provider === "email" ? "email" : selectedNode.settings.provider === "slack" ? "slack" : selectedNode.settings.provider === "openai" ? "openai" : "internal")} operationId={selectedNode.registryOperationId ?? (selectedNode.settings.provider === "email" ? "send_email" : selectedNode.settings.provider === "slack" ? "send_message" : selectedNode.settings.provider === "openai" ? "generate_text" : "create_task")} input={selectedNode.registryInput ?? (selectedNode.settings.provider === "email" ? { to: selectedNode.settings.recipient ?? "", subject: selectedNode.title, text: selectedNode.settings.message ?? "" } : selectedNode.settings.provider === "slack" ? { message: selectedNode.settings.message ?? "" } : selectedNode.settings.provider === "openai" ? { prompt: selectedNode.settings.message ?? "" } : { message: selectedNode.settings.message ?? "" })} onChange={(nodeId, operationId, input) => { draftRevision.current += 1; setValidation(null); setDefinition((current) => ({ ...current, nodes: current.nodes.map((node) => node.id === selectedNode.id ? { ...node, registryNodeId: nodeId, registryOperationId: operationId, registryInput: input, settings: { ...node.settings, provider: nodeId, operation: operationId } } : node) })); }} />}{selectedNode.type === "condition" && <div className="step-config-fields">
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
          <div className="panel-add">
            <div className="panel-add-heading"><strong>Add a step</strong><span>Choose a registered operation</span></div>
            <label htmlFor="add-registry-trigger">Registered trigger</label>
            <select id="add-registry-trigger" defaultValue="" disabled={definition.nodes.length >= 30 || definition.nodes.some((node) => node.type === "trigger")} onChange={(event) => { if (event.target.value) addRegisteredNode("trigger", event.target.value); event.currentTarget.value = ""; }}>
              <option value="">Choose trigger…</option>
              {registryCatalog.filter((item) => item.triggers.length > 0).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <label htmlFor="add-registry-action">Registered action</label>
            <select id="add-registry-action" defaultValue="" disabled={definition.nodes.length >= 30} onChange={(event) => { if (event.target.value) addRegisteredNode("action", event.target.value); event.currentTarget.value = ""; }}>
              <option value="">Choose action…</option>
              {registryCatalog.filter((item) => item.actions.length > 0).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <button onClick={() => addNode("condition")} disabled={definition.nodes.length >= 30}><span className="add-icon condition-add">◇</span><span><strong>Condition</strong><small>Check a rule</small></span><b>＋</b></button>
            <p>Only registered operations are offered here. Adding a step creates a draft; it does not execute anything.</p>
          </div>
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
