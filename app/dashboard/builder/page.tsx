"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { validateWorkflowDefinition } from "@/lib/workflows/validation";
import actionFieldValidation from "@/lib/workflows/action-field-validation.cjs";

const { isValidEmail, isHttpsUrl } = actionFieldValidation;
import "./builder.css";

type StepKind = "Trigger" | "Action" | "Condition";
type ActionField = { name: string; label: string; type: "text" | "email" | "url"; required: boolean; maxLength: number };
type CatalogAction = { id: string; provider: string; operation: string; label: string; description: string; category: string; execution: "dry_run_only" | "live_guarded"; fields: ActionField[]; requirements?: string[] };
type BuilderStep = { id: number; kind: StepKind; title: string; detail: string; actionId?: string; settings?: Record<string, string> };
type GeneratedNode = { id: string; type: "trigger" | "action" | "condition"; title: string; description: string; settings: Record<string, string> };
type RegistryStep = { id: string; nodeId: string; operationId: string; kind: "trigger" | "action"; input: unknown };
type MissingConnection = { provider: string; label: string; reason: string };
type GeneratedWorkflow = { version: 1; nodes: GeneratedNode[]; registrySteps?: RegistryStep[]; missingConnections?: MissingConnection[]; connectionStatusAvailable?: boolean };

const starterSteps: BuilderStep[] = [
  { id: 1, kind: "Trigger", title: "New form submission", detail: "Starts when a form is submitted" },
  { id: 2, kind: "Action", title: "Enrich lead details", detail: "Prepare company and contact context" },
  { id: 3, kind: "Action", title: "Send for review", detail: "Keep a person in control before outreach" },
];

const kindIcons: Record<StepKind, string> = { Trigger: "◎", Action: "↗", Condition: "◇" };

export default function WorkflowBuilderPage() {
  const router = useRouter();
  const [name, setName] = useState("Lead capture & follow-up");
  const [steps, setSteps] = useState<BuilderStep[]>(starterSteps);
  const [selected, setSelected] = useState(1);
  const [notice, setNotice] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiSaving, setAiSaving] = useState(false);
  const [aiPreview, setAiPreview] = useState<GeneratedWorkflow | null>(null);
  const [actionCatalog, setActionCatalog] = useState<CatalogAction[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState("");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("aivanta-builder-draft");
      if (saved) {
        const parsed = JSON.parse(saved) as { name?: string; steps?: BuilderStep[] };
        if (typeof parsed.name === "string") setName(parsed.name);
        if (Array.isArray(parsed.steps) && parsed.steps.length > 0) {
          setSteps(parsed.steps);
          setSelected(parsed.steps[0].id);
        }
      }
    } catch {
      // Keep the starter workflow when saved browser data is invalid.
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    let active = true;
    async function loadActionCatalog() {
      try {
        const response = await fetch("/api/workflows/actions", { headers: { Accept: "application/json" }, cache: "no-store" });
        const payload = await response.json() as { actions?: CatalogAction[]; error?: string };
        if (!response.ok || !Array.isArray(payload.actions)) throw new Error(payload.error || "Action catalog could not be loaded.");
        if (active) setActionCatalog(payload.actions);
      } catch (error) {
        if (active) setCatalogError(error instanceof Error ? error.message : "Action catalog could not be loaded.");
      } finally {
        if (active) setCatalogLoading(false);
      }
    }
    void loadActionCatalog();
    return () => { active = false; };
  }, []);

  function addStep(kind: StepKind) {
    const id = Date.now();
    const title = kind === "Trigger" ? "New event trigger" : kind === "Condition" ? "Check a condition" : "New workflow action";
    const detail = kind === "Trigger" ? "Choose what starts this workflow" : kind === "Condition" ? "Define a rule before continuing" : "Choose an action to perform";
    setSteps(current => [...current, { id, kind, title, detail }]);
    setSelected(id);
    setShowAdd(false);
    setNotice("Step added. Configure its details before activating the workflow.");
  }

  function saveDraft() {
    try {
      const raw = window.localStorage.getItem("aivanta-workflows");
      const existing = raw ? JSON.parse(raw) as Array<{ id: number; name: string; description: string; category: string; status: "Active" | "Draft" | "Paused"; runs: string; updated: string; icon: string; tone: string }> : [];
      const next = existing.filter(item => item.name !== name.trim());
      next.unshift({ id: Date.now(), name: name.trim() || "Untitled workflow", description: `${steps.length} steps · Visual workflow draft`, category: "Operations", status: "Draft", runs: "—", updated: "Just now", icon: "✳", tone: "lime" });
      window.localStorage.setItem("aivanta-workflows", JSON.stringify(next));
      setNotice("Draft saved in this browser. Live integrations and execution are not connected yet.");
    } catch {
      setNotice("Unable to save to this browser. Check storage settings and try again.");
    }
  }

  const currentStep = steps.find(step => step.id === selected) ?? steps[0];
  const validationResult = validateWorkflowDefinition({ name, steps });

  function reviewWorkflow() {
    const actionIssues = steps.filter(step => step.kind === "Action").flatMap(step => {
      if (!step.actionId) return [`Choose an action type for "${step.title}".`];
      const action = actionCatalog.find(item => item.id === step.actionId);
      if (!action) return [`The action configured for "${step.title}" is no longer available.`];
      return action.fields.flatMap(field => {
        const value = (step.settings?.[field.name] ?? "").trim();
        if (field.required && !value) return [`Fill in ${field.label} for "${step.title}".`];
        if (value.length > field.maxLength) return [`${field.label} for "${step.title}" must be ${field.maxLength} characters or fewer.`];
        if (field.type === "email" && value && !isValidEmail(value)) {
          return [`Enter a valid ${field.label.toLowerCase()} for "${step.title}".`];
        }
        if (field.type === "url" && value && !isHttpsUrl(value)) {
          return [`Enter a valid HTTPS URL for "${step.title}".`];
        }
        return [];
      });
    });
    if (actionIssues.length) {
      setNotice("Action configuration needs attention: " + actionIssues.join(" "));
      return;
    }
    if (!validationResult.valid) {
      setNotice("Review needed: " + validationResult.issues.map(issue => issue.message).join(" "));
      return;
    }
    setNotice("Basic checks passed. Activation is still disabled because live integrations, server-side validation, and execution safeguards are not connected.");
  }

  async function saveAiDraft() {
    if (!aiPreview?.registrySteps?.length || aiSaving) return;
    setAiSaving(true); setNotice(""); let createdWorkflowId = "";
    try {
      const workflowName = aiPrompt.trim().replace(/\s+/g, " ").slice(0, 80) || "AI workflow draft";
      const createdResponse = await fetch("/api/workflows", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: workflowName, description: "AI-generated registered-node draft. Review node inputs and workspace connections before running.", status: "draft" }) });
      const createdPayload = await createdResponse.json() as { workflow?: { id?: string }; error?: string };
      if (!createdResponse.ok || !createdPayload.workflow?.id) throw new Error(createdPayload.error || "Could not create a server-side draft.");
      createdWorkflowId = createdPayload.workflow.id;
      const saveResponse = await fetch("/api/workflows/" + createdWorkflowId + "/definition", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ definition: { version: 1, nodes: aiPreview.nodes }, registrySteps: aiPreview.registrySteps }) });
      const savePayload = await saveResponse.json() as { error?: string; success?: boolean };
      if (!saveResponse.ok || !savePayload.success) throw new Error(savePayload.error || "Could not save registered workflow steps.");
      router.push("/dashboard/workflows/" + createdWorkflowId + "/advanced");
    } catch (error) {
      if (createdWorkflowId) { try { await fetch("/api/workflows/" + createdWorkflowId, { method: "DELETE" }); } catch { /* best-effort cleanup */ } }
      setNotice(error instanceof Error ? error.message : "Could not save the AI draft.");
    } finally { setAiSaving(false); }
  }

  return (
    <main className="builder-shell">
      <aside className="builder-sidebar">
        <Link className="builder-brand" href="/"><span className="builder-brand-mark"><img src="/aivanta-mark.svg" alt="" aria-hidden="true" /></span>Aivanta</Link>
        <div className="builder-workspace"><span>A</span><div><strong>Acme workspace</strong><small>Free workspace</small></div><b>⌄</b></div>
        <div className="builder-nav-label">WORKSPACE</div>
        <Link className="builder-nav-link" href="/dashboard"><span>▦</span>Dashboard</Link>
        <Link className="builder-nav-link active" href="/dashboard/builder"><span>↗</span>Workflows</Link>
        <Link className="builder-nav-link" href="/dashboard/integrations"><span>⌘</span>Integrations</Link>
        <Link className="builder-nav-link" href="/dashboard/ai-assistant"><span>✺</span>AI Agents</Link>
        <Link className="builder-nav-link" href="/dashboard/templates"><span>▧</span>Templates</Link>
        <Link className="builder-nav-link" href="/dashboard/analytics"><span>▥</span>Analytics</Link>
        <Link className="builder-nav-link" href="/dashboard/settings"><span>⚙</span>Settings</Link>
        <div className="builder-sidebar-bottom"><div className="builder-help-mark">✳</div><strong>Build with confidence</strong><p>Start with a trigger, add steps, and review your logic before you connect live services.</p><Link href="/dashboard">Back to workspace ↗</Link></div>
      </aside>

      <section className="builder-main">
        <header className="builder-topbar"><div className="builder-breadcrumb"><Link href="/dashboard">Workflows</Link><span>/</span><strong>Builder</strong></div><div className="builder-top-actions"><span className="builder-draft-tag"><i /> Draft</span><button className="builder-secondary-button" onClick={saveDraft}>Save</button><button className="builder-secondary-button" onClick={reviewWorkflow}>Test</button><button className="builder-primary-button" disabled title="Activation remains disabled until integrations and execution safeguards are configured">Activate</button></div></header>
        <div className="builder-content">
          <div className="builder-title-row"><div><div className="builder-eyebrow"><span /> VISUAL WORKFLOW DESIGNER</div><input className="builder-name-input" aria-label="Workflow name" value={name} maxLength={80} onChange={event => setName(event.target.value)} /><p>Make each step clear. Keep important decisions under your control.</p></div><div className="builder-progress"><span>{steps.length} steps</span><span>{hydrated ? "Draft ready" : "Loading draft…"}</span></div></div>
          {notice && <div className="builder-notice" role="status">ⓘ {notice}<button onClick={() => setNotice("")} aria-label="Dismiss message">×</button></div>}
          <section className="ai-workflow-panel" aria-labelledby="ai-workflow-heading">
            <div className="ai-workflow-copy"><span className="builder-ai-badge">✳ AI ASSISTANT</span><h2 id="ai-workflow-heading">Describe it. We’ll draft it.</h2><p>Explain the workflow in plain English. Review the draft before applying it; nothing executes automatically.</p></div>
            <form className="ai-workflow-form" onSubmit={async event => {
              event.preventDefault();
              if (!aiPrompt.trim() || aiGenerating) return;
              setAiGenerating(true); setAiPreview(null); setNotice("");
              try {
                const response = await fetch("/api/ai/generate-workflow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: aiPrompt.trim() }) });
                const payload = await response.json() as { error?: string; definition?: GeneratedWorkflow; registrySteps?: RegistryStep[]; missingConnections?: MissingConnection[]; connectionStatusAvailable?: boolean };
                if (!response.ok || !payload.definition || !Array.isArray(payload.definition.nodes) || !Array.isArray(payload.registrySteps)) throw new Error(payload.error || "Could not generate a registered workflow draft.");
                setAiPreview({ ...payload.definition, registrySteps: payload.registrySteps, missingConnections: payload.missingConnections ?? [], connectionStatusAvailable: payload.connectionStatusAvailable ?? false });
                setNotice("AI registered-node draft ready. Review inputs, mappings, and connection status before saving; nothing has executed.");
              } catch (error) { setNotice(error instanceof Error ? error.message : "AI generation failed. Please try again."); }
              finally { setAiGenerating(false); }
            }}>
              <label htmlFor="ai-workflow-prompt">What should this workflow do?</label>
              <textarea id="ai-workflow-prompt" value={aiPrompt} maxLength={2000} onChange={event => setAiPrompt(event.target.value)} placeholder="When a new lead arrives, create a task and send a follow-up email…" rows={3} />
              <div className="ai-workflow-form-footer"><small>{aiPrompt.length}/2000 · Generated steps need review</small><button className="builder-primary-button" type="submit" disabled={aiGenerating || !aiPrompt.trim()}>{aiGenerating ? "Generating draft…" : "Generate workflow ✳"}</button></div>
            </form>
            {aiPreview && <div className="ai-workflow-preview">
              <div className="ai-preview-heading"><div><strong>Generated registered-node draft</strong><span>{aiPreview.registrySteps?.length ?? aiPreview.nodes.length} steps · schema checked · not saved or executed</span></div><button type="button" className="builder-secondary-button" onClick={() => setAiPreview(null)}>Discard</button></div>
              <ol>{(aiPreview.registrySteps ?? []).map(step => <li key={step.id}><span className={"builder-node-icon node-" + (step.kind === "trigger" ? "trigger" : "action")}>{kindIcons[step.kind === "trigger" ? "Trigger" : "Action"]}</span><div><strong>{step.nodeId}.{step.operationId}</strong><p>Registered {step.kind} · step ID: {step.id}</p><small>{JSON.stringify(step.input)}</small></div></li>)}</ol>
              {aiPreview.missingConnections?.length ? <div role="status"><strong>Connections needing attention</strong><ul>{aiPreview.missingConnections.map(item => <li key={item.provider}>{item.label}: {item.reason}</li>)}</ul></div> : null}
              {aiPreview.connectionStatusAvailable === false ? <p role="status">Workspace connection status could not be verified. Saving remains available, but connection readiness is unconfirmed.</p> : null}
              <button type="button" className="builder-primary-button ai-apply-button" disabled={aiSaving} onClick={() => void saveAiDraft()}>{aiSaving ? "Saving server draft…" : "Save reviewable server draft ↗"}</button>
            </div>}
          </section>
          <div className="builder-workspace-grid">
            <section className="canvas-panel" aria-label="Workflow canvas">
              <div className="canvas-toolbar"><div><strong>Workflow canvas</strong><small>TRIGGER → ACTIONS → OUTCOME</small></div><button onClick={() => setShowAdd(value => !value)}>＋ Add step</button></div>
              {showAdd && <div className="add-step-menu">{(["Trigger", "Action", "Condition"] as StepKind[]).map(kind => <button key={kind} onClick={() => addStep(kind)}><span>{kindIcons[kind]}</span><span><strong>{kind}</strong><small>{kind === "Trigger" ? "Start the workflow" : kind === "Action" ? "Do a task" : "Branch on a rule"}</small></span></button>)}</div>}
              <div className="flow-canvas">
                <div className="canvas-grid" />
                <div className="flow-nodes">
                  {steps.map((step, index) => <div className="flow-node-wrap" key={step.id}>
                    <button className={selected === step.id ? "builder-node selected-node" : "builder-node"} onClick={() => setSelected(step.id)}>
                      <span className={"builder-node-icon node-" + step.kind.toLowerCase()}>{kindIcons[step.kind]}</span>
                      <span className="builder-node-copy"><small>{step.kind.toUpperCase()} {String(index + 1).padStart(2, "0")}</small><strong>{step.title}</strong><span>{step.detail}</span></span>
                      <span className="node-menu">•••</span>
                    </button>
                    {index < steps.length - 1 && <div className="node-connector"><span>↓</span></div>}
                  </div>)}
                  <button className="canvas-add-node" onClick={() => setShowAdd(true)}>＋ Add next step</button>
                </div>
                <div className="canvas-zoom"><button aria-label="Zoom out" onClick={() => setNotice("Canvas zoom controls are a visual preview in this release.")}>−</button><span>100%</span><button aria-label="Zoom in" onClick={() => setNotice("Canvas zoom controls are a visual preview in this release.")}>＋</button></div>
              </div>
              <div className="canvas-foot"><span><i /> Manual prototype drafts save locally; AI registered drafts save to the server</span><span>Drag-and-drop connections coming soon</span></div>
            </section>
            <aside className="step-settings">
              <div className="settings-heading"><div><span>STEP CONFIGURATION</span><h2>Step settings</h2></div><span className="settings-icon">⌘</span></div>
              {currentStep ? <><div className="settings-kind"><span className={"builder-node-icon node-" + currentStep.kind.toLowerCase()}>{kindIcons[currentStep.kind]}</span><div><strong>{currentStep.kind}</strong><small>Step {steps.findIndex(step => step.id === currentStep.id) + 1} of {steps.length}</small></div></div>{currentStep.kind === "Action" && <section className="action-config-panel" aria-label="Action configuration">
                <label htmlFor="action-catalog-select">Action type</label>
                {catalogLoading ? <p className="action-catalog-status">Loading supported actions…</p> : catalogError ? <p className="action-catalog-status" role="alert">{catalogError} Refresh the page to retry.</p> : <>
                  <select id="action-catalog-select" className="settings-input" value={currentStep.actionId ?? ""} onChange={event => {
                    const action = actionCatalog.find(item => item.id === event.target.value);
                    if (!action) return;
                    setSteps(current => current.map(step => step.id === currentStep.id ? {
                      ...step,
                      actionId: action.id,
                      title: action.label,
                      detail: action.description,
                      settings: Object.fromEntries(action.fields.map(field => [field.name, step.settings?.[field.name] ?? ""])),
                    } : step));
                  }}>
                    <option value="">Choose an action…</option>
                    {actionCatalog.map(action => <option key={action.id} value={action.id}>{action.label}</option>)}
                  </select>
                  {(() => {
                    const action = actionCatalog.find(item => item.id === currentStep.actionId);
                    if (!action) return <p className="action-catalog-status">Choose an action to see its configuration fields.</p>;
                    return <div className="action-fields">
                      <div className="action-capability"><span className={action.execution === "live_guarded" ? "action-capability-live" : ""}>{action.execution === "live_guarded" ? "Guarded live path" : "Dry-run only"}</span><p>{action.description}</p></div>
                      {action.fields.map(field => <label className="action-field" key={field.name} htmlFor={"action-field-" + currentStep.id + "-" + field.name}>{field.label}{field.required ? " *" : ""}
                        {field.type === "text" && field.maxLength > 200 ? <textarea id={"action-field-" + currentStep.id + "-" + field.name} maxLength={field.maxLength} rows={2} value={currentStep.settings?.[field.name] ?? ""} onChange={event => setSteps(current => current.map(step => step.id === currentStep.id ? { ...step, settings: { ...step.settings, [field.name]: event.target.value } } : step))} /> : <input id={"action-field-" + currentStep.id + "-" + field.name} className="settings-input" type={field.type} maxLength={field.maxLength} required={field.required} value={currentStep.settings?.[field.name] ?? ""} onChange={event => setSteps(current => current.map(step => step.id === currentStep.id ? { ...step, settings: { ...step.settings, [field.name]: event.target.value } } : step))} />}
                      </label>)}
                      {action.requirements?.length ? <p className="action-catalog-status">Requirements: {action.requirements.join(", ").replaceAll("_", " ")}.</p> : null}
                    </div>;
                  })()}
                </>}
              </section>}
              <label htmlFor="step-title">Step name</label><input id="step-title" className="settings-input" value={currentStep.title} onChange={event => setSteps(current => current.map(step => step.id === currentStep.id ? { ...step, title: event.target.value } : step))} /><label htmlFor="step-detail">Description</label><textarea id="step-detail" className="settings-textarea" value={currentStep.detail} onChange={event => setSteps(current => current.map(step => step.id === currentStep.id ? { ...step, detail: event.target.value } : step))} rows={3} /><div className="settings-info"><span>ⓘ</span><p>Provider configuration and live credentials will be added when secure integrations are implemented.</p></div><button className="remove-step-button" disabled={steps.length <= 1} onClick={() => { setSteps(current => current.filter(step => step.id !== currentStep.id)); setSelected(steps.find(step => step.id !== currentStep.id)?.id ?? 0); }}>Remove step</button></> : <p className="settings-empty">Select a step on the canvas to edit it.</p>}
            </aside>
          </div>
          <div className="builder-safety-note"><span>✳</span><p><strong>Safe by default.</strong> The manual canvas prototype saves locally. AI-generated registered-node drafts save to the server for schema validation and later dry-run review. Saving never executes actions; live execution remains separately gated.</p></div>
        </div>
      </section>
    </main>
  );
}
