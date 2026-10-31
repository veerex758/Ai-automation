import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
import "../dashboard.css";

type Run = { id: string; workflow_id: string; mode: string; status: string; workflow_version: number; started_at: string; completed_at: string | null; duration_ms: number | null; created_at: string };
type Step = { id: string; run_id: string; status: string };
function dateLabel(value: string) { return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function statusLabel(run: Run) { if (run.mode === "dry_run") return run.status === "succeeded" ? "Dry-run passed" : "Dry-run failed"; if (run.status === "running") return "Live run in progress"; return run.status === "succeeded" ? "Live run completed" : "Live run failed"; }

export default async function ActivityPage() {
  let runs: Run[] = []; let steps: Step[] = []; const workflowNames = new Map<string, string>();
  let loadError = ""; let signedIn = false;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser(); signedIn = Boolean(user);
    if (!user) loadError = "Sign in to view activity for your workspace.";
    else {
      const workspace = await getOrCreateDefaultWorkspace(supabase);
      const { data, error } = await supabase.from("workflow_runs").select("id, workflow_id, mode, status, workflow_version, started_at, completed_at, duration_ms, created_at").eq("workspace_id", workspace.id).order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      runs = (data ?? []) as Run[];
      if (runs.length) {
        const runIds = runs.map(run => run.id); const workflowIds = [...new Set(runs.map(run => run.workflow_id))];
        const [stepResult, workflowResult] = await Promise.all([
          supabase.from("workflow_run_steps").select("id, run_id, status").in("run_id", runIds),
          supabase.from("workflows").select("id, name").in("id", workflowIds),
        ]);
        if (stepResult.error) throw stepResult.error; if (workflowResult.error) throw workflowResult.error;
        steps = (stepResult.data ?? []) as Step[];
        for (const workflow of workflowResult.data ?? []) workflowNames.set(workflow.id, workflow.name);
      }
    }
  } catch { loadError = "Activity could not be loaded right now. Refresh the page and try again."; }
  const succeeded = runs.filter(run => run.status === "succeeded").length;
  const failed = runs.filter(run => run.status === "failed").length;
  const running = runs.filter(run => run.status === "running").length;
  return <main className="app-shell">
    <aside className="sidebar">
      <Link className="dash-brand" href="/" aria-label="Aivanta home"><span className="brand-mark"><img className="brand-logo" src="/aivanta-mark.svg" alt="" aria-hidden="true"/></span><span>Aivanta</span></Link>
      <div className="workspace-switch"><span className="workspace-avatar">A</span><span className="workspace-copy"><strong>Your workspace</strong><small>Workspace</small></span></div>
      <div className="sidebar-label">WORKSPACE</div>
      <nav className="side-nav" aria-label="Workspace navigation">{[["Dashboard","/dashboard","▦"],["Workflows","/dashboard#workflows","↗"],["Integrations","/dashboard/integrations","⌘"],["AI Agents","/dashboard/ai-assistant","✺"],["Templates","/dashboard/templates","▧"],["Analytics","/dashboard/analytics","▥"],["Activity logs","/dashboard/activity","◷"],["Billing","/dashboard/billing","◇"],["Settings","/dashboard/settings","⚙"]].map(([label,href,icon])=><Link key={label} href={href} className={label==="Activity logs"?"side-link selected":"side-link"}><span className="side-icon">{icon}</span>{label}</Link>)}</nav>
    </aside>
    <section className="dashboard-main">
      <header className="dashboard-topbar"><div className="breadcrumbs">Workspace <span>/</span><strong>Activity Center</strong></div><div className="topbar-right"><span className="environment-badge"><i/> Staging / Preview</span><Link className="subtle-button" href="/dashboard">Dashboard ↗</Link></div></header>
      <div className="dashboard-content section-page-content">
        <div className="welcome-row"><div><div className="dash-eyebrow"><span className="pulse"/> WORKSPACE HISTORY</div><h1>Activity Center</h1><p>Follow recorded workflow runs and inspect their execution state. Dry-runs are always identified separately from live actions.</p></div></div>
        <div className="stats-grid activity-stats">
          <article className="stat-card"><div className="stat-heading">Recorded runs</div><div className="stat-number">{runs.length}</div><div className="stat-bottom">Latest 50 workspace records</div></article>
          <article className="stat-card"><div className="stat-heading">Passed</div><div className="stat-number">{succeeded}</div><div className="stat-bottom">Recorded successful runs</div></article>
          <article className="stat-card"><div className="stat-heading">Failed</div><div className="stat-number">{failed}</div><div className="stat-bottom">Recorded failed runs</div></article>
          <article className="stat-card"><div className="stat-heading">Live in progress</div><div className="stat-number">{running}</div><div className="stat-bottom">Currently running executions</div></article>
        </div>
        <div className="section-title-row"><div><h2>Recent executions</h2><p>Step results are summarized without exposing inputs, outputs or provider payloads.</p></div><Link className="subtle-button" href="/dashboard">Back to dashboard</Link></div>
        {loadError ? <div className="section-empty-panel" role="alert"><div className="section-empty-icon">!</div><h2>Activity unavailable</h2><p>{loadError}</p>{signedIn&&<Link className="section-card-link" href="/dashboard/activity">Try again ↗</Link>}</div> : runs.length===0 ? <div className="section-empty-panel"><div className="section-empty-icon">◷</div><h2>No recorded activity yet</h2><p>When you test or run a workflow, its recorded history will appear here. A dry-run does not perform external actions.</p><Link className="section-card-link" href="/dashboard/builder">Open workflow builder ↗</Link></div> : <div className="activity-run-list">
          {runs.map(run=>{const runSteps=steps.filter(step=>step.run_id===run.id);return <article className="activity-run-card" key={run.id}>
            <div className="activity-run-main"><div className="activity-run-indicator">{run.status==="succeeded"?"✓":run.status==="running"?"…":"!"}</div><div className="activity-run-copy"><strong>{workflowNames.get(run.workflow_id)??"Workflow"}</strong><span>{dateLabel(run.created_at)} · Version {run.workflow_version}</span></div></div>
            <div className="activity-run-meta"><span className={run.status==="succeeded"?"activity-state state-success":run.status==="running"?"activity-state state-running":"activity-state state-failed"}>{statusLabel(run)}</span><span>{runSteps.length} {runSteps.length===1?"step":"steps"}</span><span>{run.duration_ms??0} ms</span><Link href={`/dashboard/workflows/${run.workflow_id}`}>Open workflow ↗</Link></div>
          </article>})}
        </div>}
      </div>
    </section>
  </main>;
}
