"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import DashboardSidebar from "../../dashboard-sidebar";
import { useParams } from "next/navigation";
import "./builder.css";
import RunTestPanel from "./run-test-panel";
import RegistryOperationSettings from "./registry-operation-settings";
import { buildRegistrySteps } from "@/lib/workflows/build-registry-steps";
import GraphNodeBrand from "./graph-node-brand";
type RegistryCatalog = { id: string; name: string; icon?: string; category?: string; triggers: { id: string; name: string; description: string; inputSchema: { properties?: Record<string, { type?: string; title?: string; description?: string; enum?: unknown[]; default?: unknown }>; required?: string[] } }[]; actions: { id: string; name: string; description: string; inputSchema: { properties?: Record<string, { type?: string; title?: string; description?: string; enum?: unknown[]; default?: unknown }>; required?: string[] } }[] };

type NodeType = "trigger" | "action" | "condition";
type WorkflowNode = { id: string; type: NodeType; title: string; description: string; settings: Record<string, string>; registryNodeId?: string; registryOperationId?: string; registryInput?: Record<string, unknown>; position?: { x: number; y: number } };
type WorkflowEdge = { id: string; source: string; target: string; label: "true" | "false" | "next" };
type PlaybookDefinition = {
  schema: "rexnora.playbook";
  schemaVersion: 1;
  goal: { industry: "real_estate"; outcome: string };
  rules: Array<{ id: string; nodeId: string; name: string; rationale: string }>;
  actionPolicies: Array<{ stepId: string; nodeId: string; operationId: string; permission: "auto" | "ask_first" | "never" }>;
  review: { confidenceThreshold: number; reviewMissingFields: boolean; reviewWhenNoRuleMatches: boolean; reviewProviderFailures: boolean };
};
type Definition = { version: 1; nodes: WorkflowNode[]; edges?: WorkflowEdge[]; playbook?: PlaybookDefinition };
type Workflow = { id: string; name: string; description: string; status: string; version: number };
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
  const [activating, setActivating] = useState(false);
  const [webhookProvision, setWebhookProvision] = useState<{ path: string; signingSecret: string; signature: { header: string; format: string; signedMessage: string; eventIdHeader: string; eventTypeHeader: string } } | null>(null);
  const [validation, setValidation] = useState<{ valid: boolean; message: string; checkedAt: string; counts?: { triggers: number; actions: number; conditions: number } } | null>(null);
  const draftRevision = useRef(0);
  const graphCanvasRef = useRef<HTMLDivElement>(null);
  const graphViewportRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ id: string; pointerId: number; startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);
  const panState = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const fittedWorkflowId = useRef<string | null>(null);
  const [camera, setCamera] = useState({ x: 24, y: 24, scale: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [connectionLabel, setConnectionLabel] = useState<"true" | "false" | "next">("next");

  const selectedNode = definition.nodes.find((node) => node.id === selectedId) ?? definition.nodes[0] ?? null;
  const graphWidth = Math.max(1000, ...definition.nodes.map((node, index) => nodePosition(node, index).x + 250));
  const graphHeight = Math.max(680, ...definition.nodes.map((node, index) => nodePosition(node, index).y + 190));
  const isDirty = JSON.stringify(definition) !== savedFingerprint;
  const isCommentToDm = /comment to dm/i.test(workflow?.name ?? "");
  const isLeadFollowUp = /lead follow-up/i.test(workflow?.name ?? "");
  const isLeadAlert = /new lead alert/i.test(workflow?.name ?? "");
  const isFormToLead = /form to lead/i.test(workflow?.name ?? "");
  const isSupportTriage = /support ticket triage/i.test(workflow?.name ?? "");
  const isContentApproval = /content approval/i.test(workflow?.name ?? "");
  const emailActionNode = definition.nodes.find((node) => node.type === "action" && node.registryNodeId === "email" && node.registryOperationId === "send_email");
  const liveEmailRecipient = typeof emailActionNode?.registryInput?.to === "string" ? emailActionNode.registryInput.to : emailActionNode?.settings.recipient ?? "";
  const isWebhookTrigger = definition.nodes.some((node) => node.type === "trigger" && (node.registryNodeId === "webhooks" || node.settings.provider === "webhooks"));

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

  function nodePosition(node: WorkflowNode, index: number, seen = new Set<string>()): { x: number; y: number } {
    if (node.position) return node.position;
    if (seen.has(node.id)) return { x: 160 + index * 320, y: 330 };
    const nextSeen = new Set(seen);
    nextSeen.add(node.id);
    const incoming = (definition.edges ?? []).filter((edge) => edge.target === node.id);
    if (!incoming.length) return { x: 160 + index * 320, y: 330 };
    const parents = incoming.map((edge) => {
      const parentIndex = definition.nodes.findIndex((candidate) => candidate.id === edge.source);
      const parent = definition.nodes[parentIndex];
      return parent ? nodePosition(parent, Math.max(0, parentIndex), nextSeen) : { x: 160, y: 330 };
    });
    const x = Math.max(...parents.map((point) => point.x)) + 320;
    const branchY = incoming.map((edge, edgeIndex) => parents[edgeIndex].y + (edge.label === "true" ? -220 : edge.label === "false" ? 220 : 0));
    const y = branchY.reduce((sum, value) => sum + value, 0) / branchY.length;
    return { x, y };
  }

  const fitGraphToView = useCallback(() => {
    const viewport = graphViewportRef.current;
    if (!viewport) return;
    const bounds = viewport.getBoundingClientRect();
    function resolvePosition(node: WorkflowNode, index: number, seen = new Set<string>()): { x: number; y: number } {
      if (node.position) return node.position;
      if (seen.has(node.id)) return { x: 160 + index * 320, y: 330 };
      const nextSeen = new Set(seen);
      nextSeen.add(node.id);
      const incoming = (definition.edges ?? []).filter((edge) => edge.target === node.id);
      if (!incoming.length) return { x: 160 + index * 320, y: 330 };
      const parents = incoming.map((edge) => {
        const parentIndex = definition.nodes.findIndex((item) => item.id === edge.source);
        const parent = definition.nodes[parentIndex];
        return parent ? resolvePosition(parent, Math.max(0, parentIndex), nextSeen) : { x: 160, y: 330 };
      });
      const x = Math.max(...parents.map((point) => point.x)) + 320;
      const ys = incoming.map((edge, edgeIndex) => parents[edgeIndex].y + (edge.label === "true" ? -220 : edge.label === "false" ? 220 : 0));
      return { x, y: ys.reduce((sum, value) => sum + value, 0) / ys.length };
    }
    const points = definition.nodes.map((node, index) => resolvePosition(node, index));
    const left = points.length ? Math.min(...points.map((point) => point.x - 82)) : 80;
    const right = points.length ? Math.max(...points.map((point) => point.x + 82)) : Math.min(graphWidth, 700);
    const top = points.length ? Math.min(...points.map((point) => point.y - 64)) : 80;
    const bottom = points.length ? Math.max(...points.map((point) => point.y + 82)) : Math.min(graphHeight, 600);
    const contentWidth = Math.max(180, right - left);
    const contentHeight = Math.max(150, bottom - top);
    const availableWidth = Math.max(160, bounds.width - 64);
    const availableHeight = Math.max(160, bounds.height - 64);
    const scale = Math.max(0.25, Math.min(1.35, availableWidth / contentWidth, availableHeight / contentHeight));
    setCamera({
      x: (bounds.width - contentWidth * scale) / 2 - left * scale,
      y: (bounds.height - contentHeight * scale) / 2 - top * scale,
      scale,
    });
  }, [graphWidth, graphHeight, definition.nodes, definition.edges]);

  function zoomGraphTo(requestedScale: number, clientX?: number, clientY?: number) {
    const viewport = graphViewportRef.current;
    const bounds = viewport?.getBoundingClientRect();
    if (!bounds) return;
    const nextScale = Math.max(0.25, Math.min(2, requestedScale));
    const anchorX = clientX === undefined ? bounds.width / 2 : clientX - bounds.left;
    const anchorY = clientY === undefined ? bounds.height / 2 : clientY - bounds.top;
    setCamera((current) => {
      const ratio = nextScale / current.scale;
      return {
        scale: nextScale,
        x: anchorX - (anchorX - current.x) * ratio,
        y: anchorY - (anchorY - current.y) * ratio,
      };
    });
  }

  function handleGraphWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    zoomGraphTo(camera.scale * Math.exp(-event.deltaY * 0.0015), event.clientX, event.clientY);
  }

  function beginGraphPan(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest(".graph-node, .graph-viewport-controls, button")) return;
    event.preventDefault();
    panState.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: camera.x,
      originY: camera.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsPanning(true);
  }

  function moveGraphPan(event: ReactPointerEvent<HTMLDivElement>) {
    const pan = panState.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    setCamera((current) => ({
      ...current,
      x: pan.originX + event.clientX - pan.startX,
      y: pan.originY + event.clientY - pan.startY,
    }));
  }

  function endGraphPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (!panState.current || panState.current.pointerId !== event.pointerId) return;
    panState.current = null;
    setIsPanning(false);
  }

  useEffect(() => {
    if (loading || fittedWorkflowId.current === workflowId) return;
    const frame = window.requestAnimationFrame(() => {
      fitGraphToView();
      fittedWorkflowId.current = workflowId;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loading, workflowId, fitGraphToView]);

  function updateNodePosition(id: string, x: number, y: number) {
    draftRevision.current += 1;
    setValidation(null);
    setDefinition((current) => ({ ...current, nodes: current.nodes.map((node) => node.id === id ? { ...node, position: { x: Math.max(120, Math.min(3000, x)), y: Math.max(70, Math.min(2400, y)) } } : node) }));
  }

  function beginNodeDrag(event: ReactPointerEvent<HTMLDivElement>, node: WorkflowNode, index: number) {
    if ((event.target as HTMLElement).closest("button")) return;
    // Select on pointer-down so a touch drag also opens this node's inspector.
    setSelectedId(node.id);
    const point = nodePosition(node, index);
    dragState.current = { id: node.id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: point.x, originY: point.y, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveNodeDrag(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragState.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = (event.clientX - drag.startX) / camera.scale;
    const dy = (event.clientY - drag.startY) / camera.scale;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    updateNodePosition(drag.id, drag.originX + dx, drag.originY + dy);
  }

  function endNodeDrag(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragState.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    // Pointer capture can suppress click after drag; keep the dragged node selected.
    setSelectedId(drag.id);
    if (drag.moved) setNotice("Node moved. Its settings are open below; save to keep the new position.");
    dragState.current = null;
  }

  function connectNodes(source: string, target: string, label: "true" | "false" | "next") {
    if (source === target) {
      setNotice("A node cannot connect to itself.");
      setConnectingFrom(null);
      return;
    }
    const sourceNode = definition.nodes.find((node) => node.id === source);
    if (!sourceNode) {
      setNotice("The source node no longer exists. Select it again.");
      setConnectingFrom(null);
      return;
    }
    const outgoing = (definition.edges ?? []).filter((edge) => edge.source === source);
    const duplicate = outgoing.some((edge) => edge.target === target && edge.label === label);
    if (duplicate) {
      setNotice("Those nodes are already connected.");
      setConnectingFrom(null);
      return;
    }
    if (sourceNode.type === "condition") {
      if (label === "next") {
        setNotice("Choose the True or False branch before connecting an IF node.");
        setConnectingFrom(null);
        return;
      }
      if (outgoing.length >= 2 || outgoing.some((edge) => edge.label === label)) {
        setNotice("An IF node can have one True destination and one False destination. Remove or edit an existing branch first.");
        setConnectingFrom(null);
        return;
      }
    } else if (label !== "next" || outgoing.length >= 1) {
      setNotice("This node already has its single Next connection. Only IF nodes can split into two paths.");
      setConnectingFrom(null);
      return;
    }
    draftRevision.current += 1;
    setValidation(null);
    setDefinition((current) => ({
      ...current,
      nodes: current.nodes.map((node) => node.id !== target || label === "next"
        ? node
        : { ...node, position: undefined }),
      edges: [...(current.edges ?? []), { id: `edge-${Date.now().toString(36)}`, source, target, label }],
    }));
    setConnectingFrom(null);
    setNotice("Connection added. Save your changes when ready.");
  }

  function startConnectionFrom(nodeId: string) {
    const sourceNode = definition.nodes.find((node) => node.id === nodeId);
    if (!sourceNode) return;
    const outgoing = (definition.edges ?? []).filter((edge) => edge.source === nodeId);
    let label: "true" | "false" | "next" = "next";
    if (sourceNode.type === "condition") {
      if (!outgoing.some((edge) => edge.label === "true")) label = "true";
      else if (!outgoing.some((edge) => edge.label === "false")) label = "false";
      else {
        setSelectedId(nodeId);
        setConnectingFrom(null);
        setNotice("Both IF branches are already connected. Edit or remove a branch before adding another.");
        return;
      }
    } else if (outgoing.length) {
      setSelectedId(nodeId);
      setConnectingFrom(null);
      setNotice("This node already has its Next connection. Only IF nodes can split into two paths.");
      return;
    }
    setSelectedId(nodeId);
    setConnectionLabel(label);
    setConnectingFrom(nodeId);
    setNotice(sourceNode.type === "condition"
      ? `Connecting the ${label.toUpperCase()} branch. Select a destination node's input handle, or use Connect to node below.`
      : "Select a destination node's input handle, or use Connect to node below.");
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
      const payload = await response.json() as {
        definition?: Definition;
        registrySteps?: Array<{ id: string; nodeId: string; operationId: string; kind: "trigger" | "action"; input: Record<string, unknown> }>;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "AI could not create a draft.");

      // Registry generation returns executable, schema-validated steps separately
      // from its legacy placeholder definition. Build the canvas from those steps
      // so the user reviews the actual proposed workflow rather than one empty trigger.
      const steps = Array.isArray(payload.registrySteps) ? payload.registrySteps : [];
      const hasGeneratedGraph = Boolean(payload.definition?.nodes?.some((node) => node.registryNodeId));
      const generated: Definition = hasGeneratedGraph
        ? payload.definition as Definition
        : steps.length
        ? {
            version: 1,
            nodes: steps.map((step, index) => {
              const provider = registryCatalog.find((item) => item.id === step.nodeId);
              const operation = (step.kind === "trigger" ? provider?.triggers : provider?.actions)
                ?.find((item) => item.id === step.operationId);
              const settings: Record<string, string> = step.kind === "trigger"
                ? { event: "manual" }
                : { provider: step.nodeId, operation: step.operationId };
              return {
                id: step.id,
                type: step.kind,
                title: operation?.name || provider?.name || step.operationId,
                description: operation?.description || provider?.name || "Registered workflow operation.",
                settings,
                registryNodeId: step.nodeId,
                registryOperationId: step.operationId,
                registryInput: step.input,
                position: { x: 170, y: 90 + index * 210 },
              };
            }),
            edges: steps.slice(1).map((step, index) => ({
              id: `ai-edge-${index + 1}`,
              source: steps[index].id,
              target: step.id,
              label: "next" as const,
            })),
          }
        : payload.definition as Definition;

      if (!generated?.nodes?.length) throw new Error("AI could not create a reviewable workflow draft.");
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
      // Persist explicit coordinates for every node, including nodes that have
      // never been dragged. The same normalized graph is used for the request
      // and the clean-state fingerprint so reload preserves the exact layout.
      const definitionToSave: Definition = {
        ...definition,
        nodes: definition.nodes.map((node, index) => ({ ...node, position: nodePosition(node, index) })),
      };
      const response = await fetch(`/api/workflows/${workflowId}/definition`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          definition: { ...definitionToSave, nodes: definitionToSave.nodes.map((node) => ({ ...node, settings: node.type === "trigger" ? { event: "manual" } : node.type === "action" && node.registryNodeId ? { provider: "internal", operation: "create_task" } : node.settings })) },
          registrySteps: buildRegistrySteps(definitionToSave),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save workflow steps.");
      if (!Number.isSafeInteger(result.version) || result.version < 1) throw new Error("The workflow was saved, but the server did not return its saved version number. Reload before continuing.");
      setWorkflow((current) => current ? { ...current, version: result.version } : current);
      setDefinition(definitionToSave);
      setSavedFingerprint(JSON.stringify(definitionToSave));
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

  async function activateWorkflow() {
    if (activating || saving || validating || isDirty || workflow?.status === "active") return;
    const confirmed = window.confirm("Activate this saved workflow? Live webhook or email actions may run after an authenticated event. AI-generated drafts never activate themselves.");
    if (!confirmed) return;
    setActivating(true);
    setError("");
    setNotice("");
    setWebhookProvision(null);
    let activated = false;
    try {
      const response = await fetch("/api/workflows/" + workflowId, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Workflow activation was rejected.");
      activated = true;
      setWorkflow((current) => current ? { ...current, status: "active" } : current);
      if (isWebhookTrigger) {
        const webhookResponse = await fetch("/api/workflows/" + workflowId + "/webhook", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirm: true }),
        });
        const webhookResult = await webhookResponse.json();
        if (!webhookResponse.ok) {
          const pauseResponse = await fetch("/api/workflows/" + workflowId, {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "paused" }),
          });
          if (pauseResponse.ok) {
            activated = false;
            setWorkflow((current) => current ? { ...current, status: "paused" } : current);
            throw new Error((webhookResult.error || "Webhook provisioning failed.") + " The workflow has been paused; fix webhook configuration and try again.");
          }
          throw new Error((webhookResult.error || "Webhook provisioning failed.") + " The workflow may still be active; pause it before retrying.");
        }
        setWebhookProvision({
          path: webhookResult.endpoint.path,
          signingSecret: webhookResult.signingSecret,
          signature: webhookResult.signature,
        });
        setNotice("Workflow activated. Copy the webhook URL and signing secret now; the secret is shown only once.");
      } else {
        setNotice("Workflow activated. Live execution remains subject to workspace connection checks and server-side approvals.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not activate this workflow.");
    } finally {
      setActivating(false);
    }
  }

  async function pauseWorkflow() {
    if (activating || saving || validating || workflow?.status !== "active") return;
    if (!window.confirm("Pause this workflow? New webhook events will no longer execute it.")) return;
    setActivating(true);
    setError("");
    try {
      const response = await fetch("/api/workflows/" + workflowId, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "paused" }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not pause this workflow.");
      setWorkflow((current) => current ? { ...current, status: "paused" } : current);
      if (isWebhookTrigger) {
        const revoke = await fetch("/api/workflows/" + workflowId + "/webhook", { method: "DELETE" });
        if (!revoke.ok) setNotice("Workflow paused. Webhook endpoint revocation needs attention; paused workflows reject incoming events.");
        else setNotice("Workflow paused and its webhook endpoint revoked.");
      } else setNotice("Workflow paused.");
      setWebhookProvision(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not pause this workflow.");
    } finally {
      setActivating(false);
    }
  }

  if (loading) return <main className="builder-loading"><span className="builder-loader" />Loading workflow builder…</main>;
  if (error && !workflow) return <main className="builder-error"><span>!</span><h1>Couldn’t open this workflow</h1><p>{error}</p><Link href="/dashboard">Back to dashboard</Link></main>;

  return (
    <main className="builder-shell" onClick={(event) => { const link = (event.target as HTMLElement).closest("a.side-link"); if (isDirty && link && !window.confirm("You have unsaved workflow changes. Leave this page and discard them?")) event.preventDefault(); }}>
        <DashboardSidebar activePage="builder" />
      <section className="workflow-builder-main">
      <header className="builder-topbar">
        <Link href="/dashboard" className="builder-back" onClick={(event) => { if (isDirty && !window.confirm("You have unsaved workflow changes. Leave this page and discard them?")) event.preventDefault(); }}>← <span>Dashboard</span></Link>
        <div className="builder-breadcrumb"><span>Workflows</span><b>/</b><strong>{workflow?.name ?? "Workflow builder"}</strong></div>
        <div className="builder-top-actions"><a className="builder-test-link" href="#workflow-test-panel">Test workflow ↓</a><span className={`builder-draft ${isDirty ? "builder-draft-dirty" : ""}`}><i /> {isDirty ? "Unsaved changes" : `${workflow?.status ?? "Draft"} · v${workflow?.version ?? "—"}`}</span><button className="builder-validate" onClick={() => void generateDraftOnCanvas()} disabled={saving || validating}>AI draft</button><button className="builder-validate" onClick={() => void validateDraft()} disabled={validating || saving || restoringVersion !== null}>{validating ? "Checking…" : "Validate draft"}</button><button className="builder-save" onClick={() => void saveDefinition()} disabled={saving || validating || restoringVersion !== null}>{saving ? "Saving…" : restoringVersion !== null ? "Restoring…" : "Save workflow"} <span>↗</span></button>{workflow?.status === "active" ? <button className="builder-validate" onClick={() => void pauseWorkflow()} disabled={activating || isDirty}>{activating ? "Pausing…" : "Pause workflow"}</button> : <button className="builder-save" onClick={() => void activateWorkflow()} disabled={activating || isDirty || saving || validating || restoringVersion !== null}>{activating ? "Activating…" : "Activate workflow"}</button>}</div>
      </header>

      <div className="builder-layout">
        <section className="builder-workspace">
          <div className="builder-heading"><div><div className="builder-eyebrow">WORKFLOW DESIGNER</div><h1>{workflow?.name ?? "Workflow builder"}</h1><p>{workflow?.description || "Connect steps into a clear, repeatable process."}</p><a className="builder-test-link builder-test-link-prominent" href="#workflow-test-panel">↓ Find safe test panel</a></div><span className="builder-mode"><i /> Draft mode</span></div>
          {notice && <div className="builder-notice" role="status">{notice}</div>}
          {validation && <div className={`builder-validation ${validation.valid ? "validation-pass" : "validation-fail"}`} role="status"><span className="validation-mark">{validation.valid ? "✓" : "!"}</span><div><strong>{validation.valid ? "Draft checks passed" : "Draft needs attention"}</strong><p>{validation.message}</p>{validation.counts && <small>{validation.counts.triggers} trigger · {validation.counts.actions} actions · {validation.counts.conditions} conditions</small>}<small>Checked {new Date(validation.checkedAt).toLocaleTimeString()}</small></div></div>}
          {error && <div className="builder-error-banner" role="alert">{error}</div>}
          {webhookProvision && <section className="builder-notice" role="status"><strong>Webhook endpoint created — copy these details now</strong><p>POST {typeof window !== "undefined" ? window.location.origin : ""}{webhookProvision.path}</p><p>Signing secret: <code>{webhookProvision.signingSecret}</code></p><p>{webhookProvision.signature.header}: {webhookProvision.signature.format}</p><p>Event ID header: {webhookProvision.signature.eventIdHeader} · Event type header: {webhookProvision.signature.eventTypeHeader}</p><p>Signed message: <code>{webhookProvision.signature.signedMessage}</code></p><button type="button" className="builder-validate" onClick={() => void navigator.clipboard.writeText((typeof window !== "undefined" ? window.location.origin : "") + webhookProvision.path)}>Copy webhook URL</button><button type="button" className="builder-validate" onClick={() => void navigator.clipboard.writeText(webhookProvision.signingSecret)}>Copy signing secret</button><small>The signing secret is shown once. Store it securely; refreshing this page will not reveal it again.</small></section>}
          <RunTestPanel
            workflowId={workflowId}
            hasUnsavedChanges={isDirty}
            workflowStatus={workflow?.status ?? "draft"}
            isWebhookTrigger={isWebhookTrigger}
          />
          <div className="builder-canvas">
            <div className="canvas-grid" aria-hidden="true" />
            <div className="canvas-label"><span>VISUAL GRAPH · DRAG NODES · DRAG BACKGROUND TO PAN · SCROLL TO ZOOM</span><span>{definition.nodes.length} / 30 nodes</span></div>
            <div
              className={`graph-canvas ${isPanning ? "graph-canvas-panning" : ""}`}
              ref={graphViewportRef}
              role="region"
              aria-label="Workflow graph canvas. Drag the background to pan, use the mouse wheel or controls to zoom, and drag nodes to reposition."
              onPointerDown={beginGraphPan}
              onPointerMove={moveGraphPan}
              onPointerUp={endGraphPan}
              onPointerCancel={endGraphPan}
              onWheel={handleGraphWheel}
            >
              <div className="graph-grid" aria-hidden="true" />
              <div className="graph-viewport-controls" onPointerDown={(event) => event.stopPropagation()}>
                <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => zoomGraphTo(camera.scale / 1.2)}>−</button>
                <span aria-live="polite">{Math.round(camera.scale * 100)}%</span>
                <button type="button" aria-label="Fit graph to view" title="Fit graph to view" onClick={fitGraphToView}>Fit</button>
                <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => zoomGraphTo(camera.scale * 1.2)}>＋</button>
              </div>
              <div
                className="graph-layout"
                ref={graphCanvasRef}
                style={{
                  width: graphWidth,
                  height: graphHeight,
                  transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`,
                  transformOrigin: "0 0",
                }}
              >
                <svg className="graph-edges" aria-hidden="true">
                  <defs>
                    <marker id="graph-arrow" markerWidth="9" markerHeight="9" refX="7" refY="4" orient="auto">
                      <path d="M0,0 L0,8 L8,4 z" fill="#8BB8FF" />
                    </marker>
                    <marker id="graph-arrow-true" markerWidth="9" markerHeight="9" refX="7" refY="4" orient="auto">
                      <path d="M0,0 L0,8 L8,4 z" fill="#67D5A1" />
                    </marker>
                    <marker id="graph-arrow-false" markerWidth="9" markerHeight="9" refX="7" refY="4" orient="auto">
                      <path d="M0,0 L0,8 L8,4 z" fill="#F0AD79" />
                    </marker>
                  </defs>
                  {(definition.edges ?? []).map((edge) => {
                    const sourceIndex = definition.nodes.findIndex((node) => node.id === edge.source);
                    const targetIndex = definition.nodes.findIndex((node) => node.id === edge.target);
                    if (sourceIndex < 0 || targetIndex < 0) return null;
                    const source = nodePosition(definition.nodes[sourceIndex], sourceIndex);
                    const target = nodePosition(definition.nodes[targetIndex], targetIndex);
                    // Node coordinates represent the centre of the brand tile.
                    // Ports sit at the tile's horizontal midpoints, not at card corners.
                    const sx = source.x + 40;
                    const sy = source.y - 18;
                    const tx = target.x - 40;
                    const ty = target.y - 18;
                    const direction = tx >= sx ? 1 : -1;
                    const curve = Math.max(54, Math.abs(tx - sx) * 0.42);
                    const labelX = (sx + tx) / 2;
                    const labelY = (sy + ty) / 2 - 13;
                    return <g key={edge.id} className={`graph-edge graph-edge-${edge.label}`}>
                      <path d={`M ${sx} ${sy} C ${sx + curve * direction} ${sy}, ${tx - curve * direction} ${ty}, ${tx} ${ty}`} />
                      {edge.label !== "next" && <text className="graph-edge-branch-label" x={labelX} y={labelY}>{edge.label === "true" ? "TRUE" : "FALSE"}</text>}
                    </g>;
                  })}
                </svg>
                {definition.nodes.map((node, index) => {
                  const point = nodePosition(node, index);
                  const provider = registryCatalog.find((item) => item.id === node.registryNodeId);
                  const providerName = node.registryNodeId === "email" ? "Resend" : provider?.name || node.registryNodeId || nodeMeta[node.type].label;
                  return <div
                    key={node.id}
                    className={`graph-node graph-node-${node.type} ${selectedId === node.id ? "graph-node-selected" : ""} ${connectingFrom === node.id ? "graph-node-connecting" : ""}`}
                    style={{ left: point.x, top: point.y }}
                    onPointerDown={(event) => beginNodeDrag(event, node, index)}
                    onPointerMove={moveNodeDrag}
                    onPointerUp={endNodeDrag}
                    onPointerCancel={() => { dragState.current = null; }}
                    onClick={() => setSelectedId(node.id)}
                    role="group"
                    tabIndex={0}
                    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedId(node.id); } }}
                    aria-label={`${providerName}: ${node.title}. Select to configure; drag to move.`}
                    title={`${providerName} · ${node.title}`}
                  >
                    <div className="graph-node-face">
                      <button
                        type="button"
                        className="graph-node-port graph-port-in"
                        aria-label={`Connect into ${node.title}`}
                        title="Input connection"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (!connectingFrom) {
                            setNotice("Start from the output handle on the right side of a source node, then choose this node as the destination.");
                            return;
                          }
                          connectNodes(connectingFrom, node.id, connectionLabel);
                        }}
                      />
                      <GraphNodeBrand
                        providerId={node.registryNodeId || node.settings.provider || node.type}
                        providerName={providerName}
                        providerIcon={provider?.icon}
                        nodeType={node.type}
                      />
                      <button
                        type="button"
                        className="graph-node-port graph-port-out"
                        aria-label={`Connect from ${node.title}`}
                        title="Output connection"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          startConnectionFrom(node.id);
                        }}
                      />
                    </div>
                    <div className="graph-node-copy">
                      <strong className="graph-node-operation">{node.title}</strong>
                      <small className="graph-node-provider">{providerName}</small>
                    </div>
                  </div>;
                })}
                {definition.nodes.length === 0 && <div className="builder-empty"><strong>Start with a trigger</strong><button onClick={() => { const trigger = { ...starterDefinition.nodes[0], id: `trigger-${Date.now().toString(36)}` }; setDefinition({ version: 1, nodes: [trigger], edges: [] }); setSelectedId(trigger.id); }}>Add trigger</button></div>}
              </div>
            </div>
            <div className="canvas-footnote">Tap a node to select it; dragging also selects it. Use Fit and zoom to inspect the graph. The selected node&apos;s settings are below.</div>
          </div>
        </section>

        <div className="builder-mobile-edit-shortcut">
          <span>{selectedNode ? `Selected: ${selectedNode.title}` : "No node selected"}</span>
          <button type="button" disabled={!selectedNode} onClick={() => document.getElementById("node-settings-panel")?.scrollIntoView({ behavior: "smooth", block: "start" })}>Edit selected node</button>
        </div>
        <aside className="builder-panel" id="node-settings-panel">
          <div className="panel-header"><div><span className="panel-kicker">CONFIGURATION</span><h2>{selectedNode ? `Edit: ${selectedNode.title}` : "Step settings"}</h2><p className="panel-selected-hint">{selectedNode ? "Selected node · changes apply only to this step" : "Select a node on the canvas to edit it."}</p></div><span className="panel-sliders">☷</span></div>
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
              <p className="config-note">Conditions evaluate against previous-step outputs during tests and runs. Test both true and false paths before activation.</p>
            </div>}
            <div className="panel-divider" />
            <section className="graph-connection-editor" aria-label="Node connections">
              <div className="config-section-title">Connections</div>
              <p className="config-note">Start at this node&apos;s output and choose a destination. Regular nodes allow one Next connection; IF nodes allow one True and one False connection.</p>
               {selectedNode.type === "condition" && <div className="branch-connection-status"><span className={(definition.edges ?? []).some((edge) => edge.source === selectedNode.id && edge.label === "true") ? "branch-connected" : ""}>True: {(definition.edges ?? []).some((edge) => edge.source === selectedNode.id && edge.label === "true") ? "connected" : "not connected"}</span><span className={(definition.edges ?? []).some((edge) => edge.source === selectedNode.id && edge.label === "false") ? "branch-connected" : ""}>False: {(definition.edges ?? []).some((edge) => edge.source === selectedNode.id && edge.label === "false") ? "connected" : "not connected"}</span></div>}
              {(definition.edges ?? []).filter((edge) => edge.source === selectedNode.id || edge.target === selectedNode.id).map((edge) => <div className="graph-edge-row" key={edge.id}><span><b>{edge.label === "next" ? "Next" : edge.label.toUpperCase()}</b> · {definition.nodes.find((node) => node.id === edge.source)?.title} → {definition.nodes.find((node) => node.id === edge.target)?.title}</span><button type="button" aria-label="Remove connection" onClick={() => { draftRevision.current += 1; setValidation(null); setDefinition((current) => ({ ...current, edges: (current.edges ?? []).filter((item) => item.id !== edge.id) })); }}>×</button></div>)}
              {selectedNode.type === "condition" && <><label htmlFor="connection-branch">Branch label</label><select id="connection-branch" value={connectionLabel} onChange={(event) => setConnectionLabel(event.target.value as "true" | "false" | "next")}><option value="true">True path</option><option value="false">False path</option></select></>}
              <button type="button" className="builder-validate" onClick={() => startConnectionFrom(selectedNode.id)}>Start connection from this node</button>
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
