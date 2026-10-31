"use client";

import { useEffect, useState } from "react";
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
type GeneratedWorkflow = { version: 1; nodes: GeneratedNode[] };

const starterSteps: BuilderStep[] = [
  { id: 1, kind: "Trigger", title: "New form submission", detail: "Starts when a form is submitted" },
  { id: 2, kind: "Action", title: "Enrich lead details", detail: "Prepare company and contact context" },
  { id: 3, kind: "Action", title: "Send for review", detail: "Keep a person in control before outreach" },
];

const kindIcons: Record<StepKind, string> = { Trigger: "◎", Action: "↗", Condition: "◇" };

export default function WorkflowBuilderPage() {
  const [name, setName] = useState("Lead capture & follow-up");
  const [workspaceName, setWorkspaceName] = useState("Your workspace");
  const [steps, setSteps] = useState<BuilderStep[]>(starterSteps);
  const [selected, setSelected] = useState(1);
  const [notice, setNotice] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [savedWorkflowId, setSavedWorkflowId] = useState<string | null>(null);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);
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
    let active = true;
    void fetch("/api/workflows", { cache: "no-store" })
      .then(async response => {
        const payload = await response.json() as { workspace?: { name?: string } };
        if (active && response.ok && typeof payload.workspace?.name === "string") setWorkspaceName(payload.workspace.name);
      })
      .catch(() => { /* Keep the safe generic workspace label when unavailable. */ });
    return () => { active = false; };
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

  function getActionConfigurationIssues(): string[] {
    return steps.filter(step => step.kind === "Action").flatMap(step => {
      if (!step.actionId) return [`Choose an action type for "${step.title}".`];
      const action = actionCatalog.find(item => item.id === step.actionId);
      if (!action) return [`The action configured for "${step.title}" is no longer available.`];
      return action.fields.flatMap(field => {
        const value = (step.settings?.[field.name] ?? "").trim();
        if (field.required && !value) return [`Fill in ${field.label} for "${step.title}".`];
        if (value.length > field.maxLength) return [`${field.label} for "${step.title}" must be ${field.maxLength} characters or fewer.`];
        if (field.type === "email" && value && !isValidEmail(value)) return [`Enter a valid ${field.label.toLowerCase()} for "${step.title}".`];
        if (field.type === "url" && value && !isHttpsUrl(value)) return [`Enter a valid HTTPS URL for "${step.title}".`];
        return [];
      });
    });
  }

  async function saveDraft() {
    if (savingDraft) return;
    if (!name.trim() || name.trim().length > 80) {
      setNotice("Workflow names must be between 1 and 80 characters.");
      return;
    }

    if (catalogLoading) {
      setNotice("The action catalog is still loading. Please wait before saving.");
      return;
    }
    if (catalogError) {
      setNotice("The action catalog is unavailable. Reload it before saving this workflow.");
      return;
    }
    const actionIssues = getActionConfigurationIssues();
    if (actionIssues.length) {
      setNotice("Action configuration needs attention: " + actionIssues.join(" "));
      return;
    }
    if (!validationResult.valid) {
      setNotice("Review needed before saving: " + validationResult.issues.map(issue => issue.message).join(" "));
      return;
    }

    setSavingDraft(true);
    try {
      const definition = {
        version: 1,
        nodes: steps.map((step, index) => {
          const catalogAction = step.actionId ? actionCatalog.find(action => action.id === step.actionId) : undefined;
          const settings: Record<string, string> = step.kind === "Trigger"
            ? { event: step.settings?.event || "manual" }
            : step.kind === "Condition"
              ? { field: step.settings?.field || "", operator: step.settings?.operator || "equals", value: step.settings?.value || "" }
              : {
                  provider: catalogAction?.provider || "internal",
                  operation: catalogAction?.operation || "create_task",
                  ...Object.fromEntries(Object.entries(step.settings || {}).filter(([key, value]) => typeof value === "string" && value.trim())),
                };
          return {
            id: String(step.id).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || `step-${index + 1}`,
            type: step.kind.toLowerCase(),
            title: step.title.trim(),
            description: step.detail.trim(),
            settings,
          };
        }),
      };

      let workflowId = savedWorkflowId;
      const isNewWorkflow = !workflowId;
      if (!workflowId) {
        const createResponse = await fetch("/api/workflows", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            name: name.trim(),
            description: `${steps.length} steps · Visual workflow draft`,
            status: "draft",
            definition,
          }),
        });
        const created = await createResponse.json() as { workflow?: { id: string }; error?: string };
        if (!createResponse.ok || !created.workflow?.id) {
          throw new Error(created.error || "Could not create the saved workflow.");
        }
        workflowId = created.workflow.id;
        setSavedWorkflowId(workflowId);
      }

      if (!isNewWorkflow) {
      const saveResponse = await fetch(`/api/workflows/${workflowId}/definition`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        cache: "no-store",
        body: JSON.stringify({ definition }),
      });
      const saved = await saveResponse.json() as { success?: boolean; error?: string };
      if (!saveResponse.ok || !saved.success) {
        throw new Error(saved.error || "The workflow record was created, but its steps could not be saved. Please retry after checking the workflow list.");
      }
      }

      try {
        const raw = window.localStorage.getItem("aivanta-workflows");
        const existing = raw ? JSON.parse(raw) as Array<{ id: string | number; name: string; description: string; category: string; status: "Active" | "Draft" | "Paused"; runs: string; updated: string; icon: string; tone: string }> : [];
        const next = existing.filter(item => item.name !== name.trim());
        next.unshift({ id: workflowId, name: name.trim(), description: `${steps.length} steps · Saved to Aivanta`, category: "Operations", status: "Draft", runs: "—", updated: "Just now", icon: "✳", tone: "lime" });
        window.localStorage.setItem("aivanta-workflows", JSON.stringify(next));
      } catch {
        // The server save succeeded; local dashboard cache is only a convenience.
      }
      setNotice("Workflow draft saved to your Aivanta workspace. It has not been activated or executed.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to save the workflow. Try again.");
    } finally {
      setSavingDraft(false);
    }
  }

  const currentStep = steps.find(step => step.id === selected) ?? steps[0];
  const validationResult = validateWorkflowDefinition({ name, steps });

  function reviewWorkflow() {
    const actionIssues = getActionConfigurationIssues();
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

  return (
    <main className="builder-shell">
      <aside className="builder-sidebar">
        <Link className="builder-brand" href="/"><span className="builder-brand-mark"><img src="/aivanta-mark.svg" alt="" aria-hidden="true" /></span>Aivanta</Link>
        <div className="builder-workspace"><span>A</span><div><strong>{workspaceName}</strong><small>Free workspace</small></div><b>⌄</b></div>
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
        <header className="builder-topbar"><div className="builder-breadcrumb"><Link href="/dashboard">Workflows</Link><span>/</span><strong>Builder</strong></div><div className="builder-top-actions"><span className="builder-draft-tag"><i /> Draft</span><button className="builder-secondary-button" onClick={saveDraft} disabled={savingDraft}>{savingDraft ? "Saving…" : "Save draft"}</button><button className="builder-secondary-button" onClick={reviewWorkflow}>Test</button><button className="builder-primary-button" disabled title="Activation remains disabled until integrations and execution safeguards are configured">Activate</button></div></header>
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
              const mapped: BuilderStep[] = aiPreview.nodes.map((node, index) => {
                const action = node.type === "action"
                  ? actionCatalog.find(item => item.provider === node.settings.provider && item.operation === node.settings.operation)
                  : undefined;
                return {
                  id: Date.now() + index,
                  kind: node.type === "trigger" ? "Trigger" : node.type === "condition" ? "Condition" : "Action",
                  title: node.title,
                  detail: node.description || Object.entries(node.settings).map(([key, value]) => key + ": " + value).join(" · "),
                  ...(action ? { actionId: action.id } : {}),
                  ...(node.type === "action" ? { settings: { ...node.settings } } : {}),
                };
              });
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
              <div className="canvas-foot"><span><i /> Save draft stores your workflow in your Aivanta workspace</span><span>Drag-and-drop connections coming soon</span></div>
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
          <div className="builder-safety-note"><span>✳</span><p><strong>Safe by default.</strong> This is an interactive builder prototype. Saving stores a draft in this browser only. No external services run, and activation remains disabled until validation and execution safeguards are available.</p></div>
        </div>
      </section>
    </main>
  );
}
