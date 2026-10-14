"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { validateWorkflowDefinition } from "@/lib/workflows/validation";
import builderDrafts from "@/lib/workflows/builder-drafts.cjs";
import "./builder.css";

type StepKind = "Trigger" | "Action" | "Condition";
type BuilderStep = { id: number; kind: StepKind; title: string; detail: string };
type GeneratedNode = { id: string; type: "trigger" | "action" | "condition"; title: string; description: string; settings: Record<string, string> };
type GeneratedWorkflow = { version: 1; nodes: GeneratedNode[] };

const starterSteps: BuilderStep[] = [
  { id: 1, kind: "Trigger", title: "New form submission", detail: "Starts when a form is submitted" },
  { id: 2, kind: "Action", title: "Enrich lead details", detail: "Prepare company and contact context" },
  { id: 3, kind: "Action", title: "Send for review", detail: "Keep a person in control before outreach" },
];

const kindIcons: Record<StepKind, string> = { Trigger: "◎", Action: "↗", Condition: "◇" };

export default function WorkflowBuilderPage() {
  const [name, setName] = useState("Lead capture & follow-up");
  const [steps, setSteps] = useState<BuilderStep[]>(starterSteps);
  const [selected, setSelected] = useState(1);
  const [notice, setNotice] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [localDrafts, setLocalDrafts] = useState<Record<string, { name: string; steps: BuilderStep[] }>>({});
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiPreview, setAiPreview] = useState<GeneratedWorkflow | null>(null);

  useEffect(() => {
    let currentRaw: string | null = null;
    let legacyRaw: string | null = null;
    // Read the stores independently so a browser storage error on one key does not
    // prevent recovery from the other key.
    try {
      currentRaw = window.localStorage.getItem("aivanta-builder-drafts");
    } catch {
      // Continue with legacy recovery if the current-format key cannot be read.
    }
    try {
      legacyRaw = window.localStorage.getItem("aivanta-builder-draft");
    } catch {
      // Current-format drafts remain usable if the legacy key cannot be read.
    }

    const drafts = builderDrafts.loadBuilderDrafts(currentRaw, legacyRaw) as Record<string, { name: string; steps: BuilderStep[] }>;
    setLocalDrafts(drafts);
    const initialKey = "Lead capture & follow-up".toLocaleLowerCase();
    const initialDraft = drafts[initialKey] ?? Object.values(drafts)[0];
    if (initialDraft) {
      setName(initialDraft.name);
      setSteps(initialDraft.steps);
      setSelected(initialDraft.steps[0].id);
    }
    setHydrated(true);
  }, []);

  function addStep(kind: StepKind) {
    const id = builderDrafts.allocateStepIds(steps, 1)[0];
    const title = kind === "Trigger" ? "New event trigger" : kind === "Condition" ? "Check a condition" : "New workflow action";
    const detail = kind === "Trigger" ? "Choose what starts this workflow" : kind === "Condition" ? "Define a rule before continuing" : "Choose an action to perform";
    setSteps(current => [...current, { id, kind, title, detail }]);
    setSelected(id);
    setShowAdd(false);
    setNotice("Step added. Configure its details before activating the workflow.");
  }

  function saveDraft() {
    try {
      const result = builderDrafts.persistBuilderDraft(window.localStorage, localDrafts, name, steps);
      setLocalDrafts(result.drafts as Record<string, { name: string; steps: BuilderStep[] }>);
      setNotice(result.summaryUpdated
        ? "Draft and canvas steps saved in this browser. Live integrations and execution are not connected yet."
        : "Canvas draft saved locally, but the workflow list could not be updated. Check browser storage space.");
    } catch {
      setNotice("Unable to save to this browser. Check storage settings and try again.");
    }
  }

  const currentStep = steps.find(step => step.id === selected) ?? steps[0];
  const validationResult = validateWorkflowDefinition({ name, steps });

  function reviewWorkflow() {
    if (!validationResult.valid) {
      setNotice("Review needed: " + validationResult.issues.map(issue => issue.message).join(" "));
      return;
    }
    setNotice("Basic checks passed. Activation is still disabled because live integrations, server-side validation, and execution safeguards are not connected.");
  }

  return (
    <main className="builder-shell">
      <aside className="builder-sidebar">
        <Link className="builder-brand" href="/"><span className="builder-brand-mark">a</span>Aivanta<span className="builder-period">.</span></Link>
        <div className="builder-workspace"><span>A</span><div><strong>Acme workspace</strong><small>Free workspace</small></div><b>⌄</b></div>
        <div className="builder-nav-label">WORKSPACE</div>
        <Link className="builder-nav-link" href="/dashboard"><span>⌂</span>Overview</Link>
        <Link className="builder-nav-link active" href="/dashboard/builder"><span>⌘</span>Workflow builder</Link>
        <button className="builder-nav-link" onClick={() => setNotice("Integrations are coming in a later release. No external service is connected yet.")}><span>⌁</span>Integrations <small>SOON</small></button>
        <div className="builder-sidebar-bottom"><div className="builder-help-mark">✳</div><strong>Build with confidence</strong><p>Start with a trigger, add steps, and review your logic before you connect live services.</p><Link href="/dashboard">Back to workspace ↗</Link></div>
      </aside>

      <section className="builder-main">
        <header className="builder-topbar"><div className="builder-breadcrumb"><Link href="/dashboard">Workflows</Link><span>/</span><strong>Builder</strong></div><div className="builder-top-actions"><span className="builder-draft-tag"><i /> Draft</span><button className="builder-secondary-button" onClick={saveDraft}>Save draft</button><button className="builder-primary-button" onClick={reviewWorkflow}>Review &amp; activate ↗</button></div></header>
        <div className="builder-content">
          <div className="builder-title-row"><div><div className="builder-eyebrow"><span /> VISUAL WORKFLOW DESIGNER</div><input className="builder-name-input" aria-label="Workflow name" value={name} maxLength={80} onChange={event => setName(event.target.value)} /><p>Make each step clear. Keep important decisions under your control.</p></div><div className="builder-progress"><span>{steps.length} steps</span><span>{hydrated ? "Draft ready" : "Loading draft…"}</span>{Object.keys(localDrafts).length > 0 && <label className="builder-local-draft-picker">Saved local drafts <select aria-label="Load a saved local draft" value={localDrafts[name.trim().toLocaleLowerCase()] ? name.trim().toLocaleLowerCase() : ""} onChange={event => { const draft = localDrafts[event.target.value]; if (draft) { setName(draft.name); setSteps(draft.steps); setSelected(draft.steps[0]?.id ?? 0); setNotice("Loaded saved browser draft. Save after editing to update it."); } }}><option value="">Choose draft…</option>{Object.entries(localDrafts).map(([key, draft]) => <option key={key} value={key}>{draft.name}</option>)}</select></label>}</div></div>
          {notice && <div className="builder-notice" role="status">ⓘ {notice}<button onClick={() => setNotice("")} aria-label="Dismiss message">×</button></div>}
          <section className="ai-workflow-panel" aria-labelledby="ai-workflow-heading">
            <div className="ai-workflow-copy"><span className="builder-ai-badge">✳ AI ASSISTANT</span><h2 id="ai-workflow-heading">Describe it. We’ll draft it.</h2><p>Explain the workflow in plain English. Review the draft before applying it; nothing executes automatically.</p></div>
            <form className="ai-workflow-form" onSubmit={async event => {
              event.preventDefault();
              if (!aiPrompt.trim() || aiGenerating) return;
              setAiGenerating(true); setAiPreview(null); setNotice("");
              try {
                const response = await fetch("/api/ai/generate-workflow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: aiPrompt.trim() }) });
                const payload = await response.json() as { error?: string; definition?: GeneratedWorkflow };
                if (!response.ok || !payload.definition || !Array.isArray(payload.definition.nodes)) throw new Error(payload.error || "Could not generate a workflow draft.");
                setAiPreview(payload.definition);
                setNotice("AI draft ready. Review the generated steps before applying them to your canvas.");
              } catch (error) { setNotice(error instanceof Error ? error.message : "AI generation failed. Please try again."); }
              finally { setAiGenerating(false); }
            }}>
              <label htmlFor="ai-workflow-prompt">What should this workflow do?</label>
              <textarea id="ai-workflow-prompt" value={aiPrompt} maxLength={2000} onChange={event => setAiPrompt(event.target.value)} placeholder="When a new lead arrives, create a task and send a follow-up email…" rows={3} />
              <div className="ai-workflow-form-footer"><small>{aiPrompt.length}/2000 · Generated steps need review</small><button className="builder-primary-button" type="submit" disabled={aiGenerating || !aiPrompt.trim()}>{aiGenerating ? "Generating draft…" : "Generate workflow ✳"}</button></div>
            </form>
            {aiPreview && <div className="ai-workflow-preview"><div className="ai-preview-heading"><div><strong>Generated draft</strong><span>{aiPreview.nodes.length} validated steps · not saved or executed</span></div><button type="button" className="builder-secondary-button" onClick={() => setAiPreview(null)}>Discard</button></div><ol>{aiPreview.nodes.map(node => <li key={node.id}><span className={"builder-node-icon node-" + (node.type === "trigger" ? "trigger" : node.type === "condition" ? "condition" : "action")}>{kindIcons[node.type === "trigger" ? "Trigger" : node.type === "condition" ? "Condition" : "Action"]}</span><div><strong>{node.title}</strong><p>{node.description || "No additional description."}</p><small>{node.type} · {Object.entries(node.settings).map(([key, value]) => key + ": " + value).join(" · ")}</small></div></li>)}</ol><button type="button" className="builder-primary-button ai-apply-button" onClick={() => {
              const ids = builderDrafts.allocateStepIds(steps, aiPreview.nodes.length);
              const mapped: BuilderStep[] = aiPreview.nodes.map((node, index) => ({ id: ids[index], kind: node.type === "trigger" ? "Trigger" : node.type === "condition" ? "Condition" : "Action", title: node.title, detail: node.description || Object.entries(node.settings).map(([key, value]) => key + ": " + value).join(" · ") }));
              setSteps(mapped); setSelected(mapped[0]?.id ?? 0); setName(aiPrompt.trim().slice(0, 80) || "AI workflow draft"); setAiPreview(null); setNotice("AI draft applied to the canvas. Save it when ready; no actions have run.");
            }}>Apply draft to canvas ↗</button></div>}
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
              <div className="canvas-foot"><span><i /> Draft saved locally on Save draft</span><span>Drag-and-drop connections coming soon</span></div>
            </section>
            <aside className="step-settings">
              <div className="settings-heading"><div><span>STEP CONFIGURATION</span><h2>Step settings</h2></div><span className="settings-icon">⌘</span></div>
              {currentStep ? <><div className="settings-kind"><span className={"builder-node-icon node-" + currentStep.kind.toLowerCase()}>{kindIcons[currentStep.kind]}</span><div><strong>{currentStep.kind}</strong><small>Step {steps.findIndex(step => step.id === currentStep.id) + 1} of {steps.length}</small></div></div><label htmlFor="step-title">Step name</label><input id="step-title" className="settings-input" value={currentStep.title} onChange={event => setSteps(current => current.map(step => step.id === currentStep.id ? { ...step, title: event.target.value } : step))} /><label htmlFor="step-detail">Description</label><textarea id="step-detail" className="settings-textarea" value={currentStep.detail} onChange={event => setSteps(current => current.map(step => step.id === currentStep.id ? { ...step, detail: event.target.value } : step))} rows={3} /><div className="settings-info"><span>ⓘ</span><p>Provider configuration and live credentials will be added when secure integrations are implemented.</p></div><button className="remove-step-button" disabled={steps.length <= 1} onClick={() => { setSteps(current => current.filter(step => step.id !== currentStep.id)); setSelected(steps.find(step => step.id !== currentStep.id)?.id ?? 0); }}>Remove step</button></> : <p className="settings-empty">Select a step on the canvas to edit it.</p>}
            </aside>
          </div>
          <div className="builder-safety-note"><span>✳</span><p><strong>Safe by default.</strong> This is an interactive builder prototype. Saving stores a draft in this browser only. No external services run, and activation remains disabled until validation and execution safeguards are available.</p></div>
        </div>
      </section>
    </main>
  );
}
