"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import "../builder.css";

type CatalogOperation = { id: string; name: string; description: string; inputSchema: Record<string, unknown>; outputSchema: Record<string, unknown> };
type CatalogNode = { id: string; name: string; category: string; triggers: CatalogOperation[]; actions: CatalogOperation[] };
type RegistryStep = { id: string; nodeId: string; operationId: string; kind: "trigger" | "action"; input: unknown };
type RunResult = { run?: { id: string; status: string; mode: string }; steps?: Array<{ step_id: string; title: string; status: string; result: unknown }>; error?: string };

const starterSteps: RegistryStep[] = [{ id: "trigger-1", nodeId: "manual", operationId: "start", kind: "trigger", input: {} }];

function inputExample(nodeId: string, operationId: string): string {
  if (nodeId === "date_time" && operationId === "format_timestamp") return JSON.stringify({ timestamp: "2026-01-01T12:00:00Z", timeZone: "Africa/Lagos", style: "datetime" }, null, 2);
  if (nodeId === "date_time" && operationId === "compare_dates") return JSON.stringify({ left: "2026-01-01T00:00:00Z", right: "2026-01-02T00:00:00Z" }, null, 2);
  if (nodeId === "date_time" && operationId === "calculate_duration") return JSON.stringify({ start: "2026-01-01T00:00:00Z", end: "2026-01-02T00:00:00Z", unit: "hours" }, null, 2);
  if (nodeId === "loop" && operationId === "for_each") return JSON.stringify({ items: [{ email: "lead@example.com" }, { email: "customer@example.com" }], steps: [{ id: "check", nodeId: "logic", operationId: "condition", input: { left: "{{item.email}}", operator: "is_not_empty" } }], stopOnError: true }, null, 2);
  if (nodeId === "http" && operationId === "request") return JSON.stringify({ url: "https://api.example.com/items", method: "GET", auth: "none" }, null, 2);
  return "{}";
}

export default function RegistryBuilderPage() {
  const params = useParams<{ workflowId: string }>();
  const workflowId = params.workflowId;
  const [workflowName, setWorkflowName] = useState("Workflow");
  const [catalog, setCatalog] = useState<CatalogNode[]>([]);
  const [steps, setSteps] = useState<RegistryStep[]>(starterSteps);
  const [legacyDefinition, setLegacyDefinition] = useState<{ version: 1; nodes: Array<{ id: string; type: "trigger" | "action" | "condition"; title: string; description: string; settings: Record<string, string> }> }>({ version: 1, nodes: [{ id: "trigger-1", type: "trigger", title: "Manual start", description: "Registry workflow start", settings: { event: "manual" } }] });
  const [inputText, setInputText] = useState("{}");
  const [savedFingerprint, setSavedFingerprint] = useState(JSON.stringify(starterSteps));
  const [selectedId, setSelectedId] = useState("trigger-1");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [run, setRun] = useState<RunResult | null>(null);

  const selected = steps.find((step) => step.id === selectedId) ?? steps[0] ?? null;
  const dirty = JSON.stringify(steps) !== savedFingerprint;
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [definitionResponse, catalogResponse] = await Promise.all([
        fetch(`/api/workflows/${workflowId}/definition`, { cache: "no-store" }),
        fetch("/api/nodes/catalog", { cache: "no-store" }),
      ]);
      const definitionData = await definitionResponse.json();
      const catalogData = await catalogResponse.json();
      if (!definitionResponse.ok) throw new Error(definitionData.error || "Could not load workflow.");
      if (!catalogResponse.ok || !Array.isArray(catalogData.nodes)) throw new Error(catalogData.error || "Could not load node catalog.");
      setWorkflowName(definitionData.workflow?.name || "Workflow");
      if (definitionData.definition && Array.isArray(definitionData.definition.nodes)) setLegacyDefinition(definitionData.definition);
      setCatalog(catalogData.nodes as CatalogNode[]);
      const restored = Array.isArray(definitionData.registrySteps) && definitionData.registrySteps.length
        ? definitionData.registrySteps as RegistryStep[] : starterSteps;
      setSteps(restored); setSavedFingerprint(JSON.stringify(restored)); setSelectedId(restored[0]?.id ?? "");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not load registry builder."); }
    finally { setLoading(false); }
  }, [workflowId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (selected) setInputText(JSON.stringify(selected.input, null, 2)); }, [selectedId]);

  function updateStep(id: string, patch: Partial<RegistryStep>) {
    setSteps((current) => current.map((step) => step.id === id ? { ...step, ...patch } : step));
    setRun(null); setNotice("");
  }

  function addAction() {
    const available = catalog.flatMap((node) => node.actions.map((operation) => ({ nodeId: node.id, operationId: operation.id, name: node.name + " · " + operation.name })))
      .filter((operation) => !(operation.nodeId === "loop" && operation.operationId === "for_each" && steps.some((step) => step.nodeId === "loop")));
    if (!available.length || steps.length >= 30) return;
    const first = available.find((operation) => operation.nodeId === "date_time") ?? available[0];
    const id = "step-" + Date.now().toString(36);
    setSteps((current) => [...current, { id, nodeId: first.nodeId, operationId: first.operationId, kind: "action", input: JSON.parse(inputExample(first.nodeId, first.operationId)) }]);
    setSelectedId(id); setRun(null); setNotice("Registry step added. Configure the input JSON and save before testing.");
  }

  function changeOperation(stepId: string, nodeId: string, operationId: string) {
    updateStep(stepId, { nodeId, operationId, input: JSON.parse(inputExample(nodeId, operationId)) });
  }

  async function save() {
    if (saving || testing || dirty === false) return;
    try { JSON.parse(inputText); } catch { setError("Finish the input JSON before saving."); return; }
    setSaving(true); setError(""); setNotice(""); setRun(null);
    try {
      const response = await fetch(`/api/workflows/${workflowId}/definition`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          definition: legacyDefinition,
          registrySteps: steps,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save registry workflow.");
      setSavedFingerprint(JSON.stringify(steps)); setNotice(`Registry workflow saved as version ${data.version}.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save registry workflow."); }
    finally { setSaving(false); }
  }

  async function test() {
    if (testing || dirty || saving) return;
    setTesting(true); setError(""); setNotice(""); setRun(null);
    try {
      const response = await fetch(`/api/workflows/${workflowId}/registry-run`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: true }),
      });
      const data = await response.json() as RunResult;
      if (!response.ok) throw new Error(data.error || "Could not run the safe preview.");
      setRun(data); setNotice("Safe preview recorded in run history. Registry actions were simulated; no external services were called.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not run the safe preview."); }
    finally { setTesting(false); }
  }

  if (loading) return <main className="builder-loading">Loading advanced node builder…</main>;
  if (error && !catalog.length) return <main className="builder-error"><h1>Couldn’t open advanced builder</h1><p>{error}</p><Link href={`/dashboard/workflows/${workflowId}`}>Back to workflow</Link></main>;

  return <main className="builder-shell">
    <aside className="workflow-side-nav">
      <Link className="workflow-side-brand" href="/"><span><img src="/aivanta-mark.svg" alt="" aria-hidden="true" /></span>Aivanta</Link>
      <div className="workflow-side-label">WORKSPACE</div>
      <Link className="workflow-side-link active" href={`/dashboard/workflows/${workflowId}`}>← Visual workflow</Link>
      <Link className="workflow-side-link" href="/dashboard">Dashboard</Link>
      <div className="workflow-side-bottom"><strong>Advanced nodes</strong><small>Registry-backed workflow steps</small></div>
    </aside>
    <section className="workflow-builder-main">
      <header className="builder-topbar">
        <Link className="builder-back" href={`/dashboard/workflows/${workflowId}`}>← <span>Visual builder</span></Link>
        <div className="builder-breadcrumb"><span>{workflowName}</span><b>/</b><strong>Advanced nodes</strong></div>
        <div className="builder-top-actions">
          <span className={`builder-draft ${dirty ? "builder-draft-dirty" : ""}`}>{dirty ? "Unsaved changes" : "Saved"}</span>
          <button className="builder-validate" disabled={saving || testing || dirty} onClick={() => void test()}>{testing ? "Testing…" : "Run safe preview"}</button>
          <button className="builder-save" disabled={saving || testing || !dirty} onClick={() => void save()}>{saving ? "Saving…" : "Save nodes ↗"}</button>
        </div>
      </header>
      <div className="builder-layout">
        <section className="builder-workspace">
          <div className="builder-heading"><div><div className="builder-eyebrow">REGISTRY WORKFLOW DESIGNER</div><h1>{workflowName}</h1><p>Configure registered node operations, save them, and record safe previews in run history.</p></div><span className="builder-mode"><i /> Draft mode</span></div>
          {notice && <div className="builder-notice" role="status">{notice}</div>}
          {error && <div className="builder-error-banner" role="alert">{error}</div>}
          <div className="builder-canvas">
            <div className="canvas-grid" aria-hidden="true" />
            <div className="canvas-label"><span>REGISTRY CANVAS</span><span>{steps.length} / 30 steps</span></div>
            <div className="node-stack">
              {steps.map((step, index) => {
                const node = catalog.find((item) => item.id === step.nodeId);
                const operation = node?.[step.kind === "trigger" ? "triggers" : "actions"].find((item) => item.id === step.operationId);
                return <div className="node-slot" key={step.id}>
                  {index > 0 && <div className="node-connector"><span>↓</span></div>}
                  <button className={`builder-node node-${step.kind === "trigger" ? "trigger" : "action"} ${selectedId === step.id ? "node-selected" : ""}`} onClick={() => setSelectedId(step.id)} aria-pressed={selectedId === step.id}>
                    <span className="node-icon">{step.kind === "trigger" ? "⚡" : node?.id === "date_time" ? "◷" : node?.id === "loop" ? "↻" : "↗"}</span>
                    <span className="node-copy"><small>{node?.name ?? step.nodeId} · STEP {index + 1}</small><strong>{operation?.name ?? step.operationId}</strong><span>{operation?.description ?? "Registered operation"}</span></span><span className="node-chevron">›</span>
                  </button>
                  {index < steps.length - 1 && <div className="node-endpoint">↓ Connected to next step</div>}
                </div>;
              })}
            </div>
            <div className="canvas-footnote">A safe preview validates saved registry steps and writes run/step history. It never sends external requests.</div>
          </div>
          <section className="version-history">
            <div className="panel-add-heading"><strong>Run history</strong><span>Latest safe preview</span></div>
            {run?.run && <div className="builder-notice"><strong>{run.run.status}</strong> · {run.run.mode} · run {run.run.id}</div>}
            {run?.steps && <ol>{run.steps.map((step) => <li key={step.step_id}><span><strong>{step.title}</strong><small>{step.status}</small></span></li>)}</ol>}
            <Link href={`/dashboard/workflows/${workflowId}#workflow-test-panel`}>Open workflow run history ↗</Link>
          </section>
        </section>
        <aside className="builder-panel">
          <div className="panel-header"><div><span className="panel-kicker">CONFIGURATION</span><h2>Node settings</h2></div></div>
          {selected && <div className="panel-content">
            <label htmlFor="registry-node">Node</label>
            <select id="registry-node" value={selected.nodeId + "." + selected.operationId} disabled={selected.kind === "trigger"} onChange={(event) => { const [nodeId, operationId] = event.target.value.split("."); changeOperation(selected.id, nodeId, operationId); }}>
              {catalog.flatMap((node) => node.actions.map((operation) => <option key={node.id + "." + operation.id} value={node.id + "." + operation.id}>{node.name} · {operation.name}</option>))}
            </select>
            <label htmlFor="registry-input">Input JSON</label>
            <textarea id="registry-input" rows={18} spellCheck={false} value={inputText} onChange={(event) => {
              setInputText(event.target.value);
              try { updateStep(selected.id, { input: JSON.parse(event.target.value) as unknown }); setError(""); }
              catch { setError("Input JSON is incomplete or invalid. Finish the JSON before saving."); }
            }} />
            {selected.kind !== "trigger" && <button className="remove-step" type="button" onClick={() => { setSteps((current) => current.filter((step) => step.id !== selected.id)); setSelectedId(steps.find((step) => step.id !== selected.id)?.id ?? ""); setRun(null); }}>Remove node</button>}
            <div className="config-note">HTTP requests are allowlist-only and live execution remains guarded. Date & Time and Loop actions are available to the registry runner; safe previews never perform provider side effects.</div>
          </div>}
          <div className="panel-add">
            <div className="panel-add-heading"><strong>Add a node</strong><span>Registered actions</span></div>
            <button type="button" onClick={addAction} disabled={steps.length >= 30}><span className="add-icon action-add">＋</span><span><strong>Add action</strong><small>Date & Time, Loop, HTTP, Utilities and more</small></span><b>＋</b></button>
            <p>Delay / Wait is intentionally not offered until durable resume and run-history continuation are implemented.</p>
          </div>
        </aside>
      </div>
    </section>
  </main>;
}
