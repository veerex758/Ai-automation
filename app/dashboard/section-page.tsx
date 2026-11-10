import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
import RegistryIntegrationsDirectory from "./registry-integrations-directory";
import "./dashboard.css";

type Section = "integrations" | "templates" | "analytics" | "activity" | "billing" | "settings";
const navigation = [
  ["Dashboard","/dashboard","▦"],["Workflows","/dashboard#workflows","↗"],["Integrations","/dashboard/integrations","⌘"],["AI Agents","/dashboard/agents","✺"],["Templates","/dashboard/templates","▧"],["Analytics","/dashboard/analytics","▥"],["Activity logs","/dashboard/activity","◷"],["Billing","/dashboard/billing","◇"],["Settings","/dashboard/settings","⚙"],
] as const;
const templates = [
  {name:"Lead Capture & Welcome Email",category:"Lead capture",description:"Start from a website form, record lead details, and prepare a welcome message."},
  {name:"Support Ticket Triage",category:"Customer support",description:"Check incoming requests and prepare a support follow-up task."},
  {name:"Content Approval",category:"Content",description:"Create a simple review flow for submitted content."},
  {name:"Lead Follow-up",category:"Sales",description:"Organize follow-up tasks when a new lead is received."},
];
type WorkflowRunRecord = { id: string; workflow_id: string; status: string; mode: string; created_at: string };
type AnalyticsData = {
 total: number;
 succeeded: number;
 failed: number;
 running: number;
 recent: Array<WorkflowRunRecord & { name: string }>;
};

async function loadAnalytics(): Promise<AnalyticsData | null> {
 try {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return null;
  const workspace = await getOrCreateDefaultWorkspace(supabase);
  const { data, error } = await supabase
   .from("workflow_runs")
   .select("id, workflow_id, status, mode, created_at")
   .eq("workspace_id", workspace.id)
   .order("created_at", { ascending: false })
   .limit(100);
  if (error) throw error;
  const runs = (data ?? []) as WorkflowRunRecord[];
  const workflowIds = [...new Set(runs.map(run => run.workflow_id))];
  const names = new Map<string, string>();
  if (workflowIds.length) {
   const { data: workflows, error: workflowError } = await supabase
    .from("workflows")
    .select("id, name")
    .eq("workspace_id", workspace.id)
    .in("id", workflowIds);
   if (workflowError) throw workflowError;
   for (const workflow of workflows ?? []) names.set(workflow.id, workflow.name);
  }
  return {
   total: runs.length,
   succeeded: runs.filter(run => run.status === "succeeded").length,
   failed: runs.filter(run => run.status === "failed").length,
   running: runs.filter(run => ["running", "queued", "waiting"].includes(run.status)).length,
   recent: runs.slice(0, 6).map(run => ({ ...run, name: names.get(run.workflow_id) ?? "Workflow" })),
  };
 } catch {
  return null;
 }
}

const titles: Record<Section,{title:string;description:string}> = {
 integrations:{title:"Integrations",description:"Connect the tools your workflows need. Connections are only shown as active when credentials and authorization are configured."},
 templates:{title:"Workflow Templates",description:"Start from a reusable workflow idea, then review and configure the draft in the builder."},
 analytics:{title:"Analytics",description:"A clear view of workflow activity and reliability. Execution metrics appear once run history is connected."},
 activity:{title:"Activity Center",description:"Review workflow events and execution history for the current workspace."},
 billing:{title:"Billing & Plan",description:"Manage your plan and understand which billing capabilities are currently configured."},
 settings:{title:"Workspace Settings",description:"Review workspace context and security boundaries for your Aivanta account."},
};
export default async function DashboardSectionPage({section}:{section:Section}) {
 const meta=titles[section];
 const analytics = section === "analytics" ? await loadAnalytics() : null;
 const completedRuns = analytics ? analytics.succeeded + analytics.failed : 0;
 const successRate = completedRuns > 0 && analytics ? Math.round(analytics.succeeded / completedRuns * 100) : null;
 let workspaceName = "Your workspace";
 try {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) workspaceName = (await getOrCreateDefaultWorkspace(supabase)).name;
 } catch {
  // Keep the generic label if workspace metadata is temporarily unavailable.
 }
 return <main className="app-shell">
  <aside className="sidebar">
   <Link className="dash-brand" href="/" aria-label="Aivanta home"><span className="brand-mark"><img className="brand-logo" src="/aivanta-mark.svg" alt="" aria-hidden="true"/></span><span>Aivanta</span></Link>
   <div className="workspace-switch"><span className="workspace-avatar">{workspaceName.slice(0, 1).toUpperCase()}</span><span className="workspace-copy"><strong>{workspaceName}</strong><small>Workspace</small></span><span className="switch-chevron">⌄</span></div>
   <div className="sidebar-label">WORKSPACE</div><nav className="side-nav" aria-label="Workspace navigation">{navigation.map(([label,href,icon])=><Link key={label} href={href} className={(label==="Integrations"&&section==="integrations")||(label==="Templates"&&section==="templates")||(label==="Analytics"&&section==="analytics")||(label==="Activity logs"&&section==="activity")||(label==="Billing"&&section==="billing")||(label==="Settings"&&section==="settings")?"side-link selected":"side-link"}><span className="side-icon">{icon}</span>{label}</Link>)}</nav>
   <div className="sidebar-bottom"><div className="help-card"><span className="help-icon">✺</span><strong>Build with confidence</strong><p>Review every step before connecting live services.</p><Link href="/dashboard/builder">Open builder ↗</Link></div></div>
  </aside>
  <section className="dashboard-main"><header className="dashboard-topbar"><div className="breadcrumbs">Workspace <span>/</span><strong>{meta.title}</strong></div><div className="topbar-right"><span className="environment-badge"><i/> Staging / Preview</span><Link className="subtle-button" href="/dashboard">Dashboard ↗</Link></div></header>
   <div className="dashboard-content section-page-content"><div className="welcome-row"><div><div className="dash-eyebrow"><span className="pulse"/> AIVANTA WORKSPACE</div><h1>{meta.title}</h1><p>{meta.description}</p></div>{section==="templates"?<Link className="create-button" href="/dashboard#quick-start-title">Browse templates ↗</Link>:section==="integrations"?<Link className="create-button" href="/dashboard/settings">Connection settings ↗</Link>:null}</div>
   {section==="integrations"&&<><div className="section-title-row"><div><h2>Available integrations</h2><p>The full provider inventory is listed below. Only providers with registered, validated operations are selectable in workflow drafts; live runs remain gated.</p></div></div><RegistryIntegrationsDirectory /></>}
   {section==="templates"&&<><div className="section-title-row"><div><h2>Starter workflows</h2><p>Open the dashboard template gallery to create an editable draft.</p></div></div><div className="section-cards-grid">{templates.map(item=><article className="section-info-card" key={item.name}><div className="quick-template-meta"><span>{item.category}</span><span>Starter</span></div><h3>{item.name}</h3><p>{item.description}</p><Link className="section-card-link" href="/dashboard#quick-start-title">Set up template ↗</Link></article>)}</div></>}
   {section==="analytics"&&(!analytics?<div className="section-empty-panel"><div className="section-empty-icon">▥</div><h2>Analytics unavailable</h2><p>Sign in and verify workspace access to load execution metrics.</p></div>:<><div className="stats-grid"><article className="stat-card"><div className="stat-heading">Recorded runs <span className="stat-symbol">↗</span></div><div className="stat-number">{analytics.total}</div><div className="stat-bottom">Latest 100 workspace runs</div></article><article className="stat-card"><div className="stat-heading">Success rate <span className="stat-symbol">✓</span></div><div className="stat-number">{successRate===null?"—":`${successRate}%`}</div><div className="stat-bottom">Based on completed runs</div></article><article className="stat-card"><div className="stat-heading">Failed runs <span className="stat-symbol">!</span></div><div className="stat-number">{analytics.failed}</div><div className="stat-bottom">Persisted failures</div></article><article className="stat-card"><div className="stat-heading">In progress <span className="stat-symbol">◷</span></div><div className="stat-number">{analytics.running}</div><div className="stat-bottom">Running, queued or waiting</div></article></div><div className="section-title-row"><div><h2>Recent workflow runs</h2><p>Metrics come from persisted workspace run records; dry-runs remain distinct from live runs.</p></div><Link className="subtle-button" href="/dashboard/activity">View activity ↗</Link></div>{analytics.recent.length?<div className="analytics-run-list">{analytics.recent.map(run=><article className="analytics-run-card" key={run.id}><div className="analytics-run-copy"><strong>{run.name}</strong><span>{new Date(run.created_at).toLocaleString()} · {run.mode==="dry_run"?"Dry-run":"Live"}</span></div><div className="analytics-run-meta"><span className={run.status==="succeeded"?"workflow-status status-active":run.status==="failed"?"workflow-status status-paused":"workflow-status status-draft"}><i/>{run.status.replaceAll("_"," ")}</span><Link href={`/dashboard/workflows/${run.workflow_id}`}>Open workflow ↗</Link></div></article>)}</div>:<div className="section-empty-panel"><div className="section-empty-icon">▥</div><h2>No execution data yet</h2><p>Analytics will populate as this workspace records workflow runs. No activity or time-saved estimates are fabricated.</p><Link className="section-card-link" href="/dashboard/builder">Build a workflow ↗</Link></div>}</>)}
   {section==="activity"&&<div className="section-empty-panel"><div className="section-empty-icon">◷</div><h2>No activity to show yet</h2><p>Workflow events and run details will appear here when the activity feed is connected. Try again after a workflow has recorded activity.</p><Link className="section-card-link" href="/dashboard">Return to dashboard ↗</Link></div>}
   {section==="billing"&&<><div className="billing-plan-card"><div><div className="dash-eyebrow">CURRENT WORKSPACE PLAN</div><h2>Starter</h2><p>Billing provider is not connected in this preview. No subscription or payment is being charged from this page.</p></div><span className="workflow-status status-draft"><i/>Billing not configured</span></div><div className="section-cards-grid"><article className="section-info-card"><h3>Workflow access</h3><p>Create and manage workflow drafts in your workspace.</p></article><article className="section-info-card"><h3>AI workflow generation</h3><p>Available only when authenticated and server-side AI provider configuration is present.</p></article><article className="section-info-card"><h3>Usage and invoices</h3><p>Usage-based billing and invoice history are not connected in this preview.</p></article></div></>}
   {section==="settings"&&<><div className="settings-section-card"><div className="settings-section-icon">⌂</div><div><h3>Workspace profile</h3><p>Workspace name and membership are supplied by the authenticated session when available.</p></div><span className="workflow-status status-draft"><i/>Session scoped</span></div><div className="settings-section-card"><div className="settings-section-icon">⬟</div><div><h3>Security &amp; access</h3><p>Workspace data access must be enforced by server-side authorization and database policies. Do not store provider secrets in browser settings.</p></div><span className="workflow-status status-active"><i/>Guardrails</span></div><div className="settings-section-card"><div className="settings-section-icon">✉</div><div><h3>Email testing</h3><p>Email testing and live sending must remain separate. Use a configured staging integration before testing external delivery.</p></div><Link className="section-card-link" href="/dashboard/builder">Open builder ↗</Link></div></>}
   </div>
  </section>
 </main>;
}
