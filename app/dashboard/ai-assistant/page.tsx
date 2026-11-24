import { redirect } from "next/navigation";

export default function LegacyAIAssistantRedirect() {
  redirect("/dashboard/playbooks/new");
}

/* Legacy implementation retired; all authoring now starts with a Playbook. */
/* "use client"; */

import { FormEvent, useEffect, useState } from "react";
import DashboardSidebar from "../dashboard-sidebar";
import { useRouter } from "next/navigation";
import "./assistant.css";

type GeneratedDraft = {
  definition?: { version: 1; nodes: Array<Record<string, unknown>>; edges?: Array<Record<string, unknown>> };
  registrySteps?: Array<{ id: string; nodeId: string; operationId: string; kind: "trigger" | "action"; input: Record<string, unknown> }>;
  summary?: string;
  error?: string;
  errorCode?: string;
};

function titleForGenerationError(code?: string): string {
  const titles: Record<string, string> = {
    AI_PROVIDER_OVERLOADED: "Gemini is temporarily overloaded",
    AI_RATE_LIMITED: "Gemini rate limit reached",
    AI_PROVIDER_AUTH_ERROR: "Gemini server configuration issue",
    AI_TIMEOUT: "Gemini request timed out",
    AI_PROVIDER_UNAVAILABLE: "Gemini could not be reached",
    AI_PROVIDER_ERROR: "Gemini provider error",
    AI_NOT_CONFIGURED: "Gemini is not configured",
    AI_CREDIT_LIMIT_REACHED: "Monthly AI allowance reached",
    AI_SUBSCRIPTION_INACTIVE: "Workspace subscription inactive",
    AI_USAGE_METERING_UNAVAILABLE: "Usage metering unavailable",
    AI_UNSAFE_WORKFLOW: "Generated workflow failed validation",
    AI_UNSUPPORTED_CAPABILITY: "Requested integration capability is not available yet",
    AI_INVALID_JSON: "Gemini returned an invalid workflow format",
    AI_INVALID_RESPONSE: "Gemini returned an unreadable response",
  };
  return code && titles[code] ? titles[code] : "Couldn't generate the workflow";
}

export default function AIAssistantPage() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");
  const [errorTitle, setErrorTitle] = useState("Couldn't generate the workflow");
  const [loading, setLoading] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("Your workspace");

  useEffect(() => {
    let active = true;
    void fetch("/api/workflows", { cache: "no-store" })
      .then(async response => {
        if (!response.ok) return;
        const result = await response.json() as { workspace?: { name?: string } };
        if (active && typeof result.workspace?.name === "string") setWorkspaceName(result.workspace.name);
      })
      .catch(() => { /* Keep the generic workspace label if metadata is unavailable. */ });
    return () => { active = false; };
  }, []);

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const requestText = prompt.trim();
    if (!requestText || loading) return;
    setLoading(true);
    setError("");
    setErrorTitle("Couldn't generate the workflow");
    try {
      const response = await fetch("/api/ai/generate-workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ prompt: requestText }),
      });
      const generated = await response.json() as GeneratedDraft;
      if (!response.ok) {
        setErrorTitle(titleForGenerationError(generated.errorCode));
        throw new Error(generated.error || "Gemini could not create a validated workflow. Please try again.");
      }
      if (!generated.definition || !Array.isArray(generated.registrySteps) || generated.registrySteps.length === 0) {
        setErrorTitle("Generated workflow failed validation");
        throw new Error("Rexnora did not receive a complete registry-validated graph. No workflow was created.");
      }

      // Create an inactive draft so the user lands directly on its real graph canvas.
      // This endpoint persists the validated graph; it does not activate or execute it.
      const createResponse = await fetch("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({
          name: requestText.slice(0, 80) || "AI workflow draft",
          description: (generated.summary || "Gemini-generated workflow draft for review.").slice(0, 500),
          status: "draft",
          definition: generated.definition,
          registrySteps: generated.registrySteps,
        }),
      });
      const created = await createResponse.json() as { workflow?: { id: string }; error?: string };
      if (!createResponse.ok || !created.workflow?.id) {
        throw new Error(created.error || "Gemini generated the graph, but Rexnora couldn't create its draft. Nothing was executed.");
      }
      router.push(`/dashboard/workflows/${encodeURIComponent(created.workflow.id)}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Workflow generation failed safely.");
      setLoading(false);
    }
  }

  return <main className="app-shell ai-assistant-shell">
    <DashboardSidebar activePage="assistant" workspaceName={workspaceName} />
    <section className="dashboard-main">
      <header className="dashboard-topbar"><div className="breadcrumbs">Workspace <span>/</span><strong>AI workflow designer</strong></div><div className="topbar-right"><span className="environment-badge"><i /> Draft mode</span><span className="top-avatar">AI</span></div></header>
      <div className="dashboard-content ai-assistant-content">
        <div className="ai-assistant-intro"><div className="assistant-symbol">✺</div><div><div className="dash-eyebrow">REXNORA AI WORKFLOW DESIGNER <span className="assistant-beta">BETA</span></div><h1>Describe it. See it on the canvas.</h1><p>Tell Gemini what outcome you want. Rexnora validates the registered operations, creates an inactive draft and opens the visual workflow canvas for you to inspect and edit.</p></div></div>
        <div className="assistant-layout">
          <section className="assistant-chat-panel">
            <div className="assistant-chat-header"><div className="assistant-avatar">✺</div><div><strong>Build on the visual canvas</strong><small>Gemini generation · editable graph · no automatic execution</small></div><span className="assistant-status">Ready</span></div>
            <div className="assistant-message assistant-message-info"><span className="assistant-message-icon">✺</span><div><strong>What should your workflow accomplish?</strong><p>Example: “When a new real-estate enquiry arrives, qualify the lead with Gemini, route qualified leads to an agent and send an approved summary through Resend.”</p></div></div>
            {loading && <div className="assistant-chat-turn assistant-chat-reply" role="status"><strong>Rexnora</strong><p>Gemini is generating and validating your workflow. The visual canvas will open automatically when the draft is ready…</p></div>}
            {error && <div className="assistant-error" role="alert"><strong>{errorTitle}</strong><p>{error}</p></div>}
            <form className="assistant-prompt-form" onSubmit={generate}>
              <label htmlFor="assistant-prompt">Describe the automation you want</label>
              <textarea id="assistant-prompt" value={prompt} onChange={event => setPrompt(event.target.value)} maxLength={2000} rows={5} placeholder="When a new lead fills out my website form, qualify it with AI, check the budget, and notify the right agent…" required />
              <div className="assistant-form-footer"><span>{prompt.length}/2000 · Creates an inactive draft</span><button type="submit" disabled={loading || !prompt.trim()}>{loading ? "Building graph…" : "Generate on visual canvas"} <span>↗</span></button></div>
            </form>
            <p className="assistant-safety-note">Your workflow opens in the visual Builder. You can inspect connections, drag nodes, edit settings and conditional paths, then save changes. Generation never activates or executes a workflow.</p>
          </section>
          <aside className="assistant-side-panel"><h2>From description to graph</h2><div><span>1</span><p><strong>Describe the outcome</strong><small>Explain the trigger, apps, decisions and result in plain language.</small></p></div><div><span>2</span><p><strong>Gemini builds the graph</strong><small>Only registered operations and validated connections are accepted.</small></p></div><div><span>3</span><p><strong>Review on the canvas</strong><small>Drag nodes, configure steps, edit branches and save a new draft version.</small></p></div><div className="assistant-tip"><strong>Safe by default</strong><p>The generated workflow remains inactive. Testing and activation are separate, deliberate actions.</p></div></aside>
        </div>
      </div>
    </section>
  </main>;
}
