"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import "./builder.css";

type StepKind = "Trigger" | "Action" | "Condition";
type BuilderStep = { id: number; kind: StepKind; title: string; detail: string };

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

  const currentStep = steps.find(step => step.id === selected) ?? steps[0];\n  const validationIssues = [\n    !name.trim() ? "Give this workflow a name." : "",\n    !steps.some(step => step.kind === "Trigger") ? "Add at least one trigger." : "",\n    steps.some(step => !step.title.trim()) ? "Every step needs a name." : "",\n  ].filter(Boolean);\n\n  function reviewWorkflow() {\n    if (validationIssues.length) {\n      setNotice("Review needed: " + validationIssues.join(" "));\n      return;\n    }\n    setNotice("Basic checks passed. Activation is still disabled because live integrations, server-side validation, and execution safeguards are not connected.");\n  }

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
          <div className="builder-title-row"><div><div className="builder-eyebrow"><span /> VISUAL WORKFLOW DESIGNER</div><input className="builder-name-input" aria-label="Workflow name" value={name} maxLength={80} onChange={event => setName(event.target.value)} /><p>Make each step clear. Keep important decisions under your control.</p></div><div className="builder-progress"><span>{steps.length} steps</span><span>{hydrated ? "Draft ready" : "Loading draft…"}</span></div></div>
          {notice && <div className="builder-notice" role="status">ⓘ {notice}<button onClick={() => setNotice("")} aria-label="Dismiss message">×</button></div>}
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
