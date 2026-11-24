import Link from "next/link";

type ActivePage = "overview" | "workflows" | "playbooks" | "agents" | "templates" | "integrations" | "connections" | "analytics" | "activity" | "billing" | "settings" | "realestate";

const groups = [
  { label: "WORKSPACE", items: [
    { label: "Overview", icon: "⌂", href: "/dashboard", key: "overview" },
    { label: "Workflows", icon: "↗", href: "/dashboard#workflows", key: "workflows" },
    { label: "Activity logs", icon: "◷", href: "/dashboard/activity", key: "activity" },
  ] },
  { label: "BUILD", items: [
    { label: "Workflow builder", icon: "＋", href: "/dashboard/builder", key: "builder" },
    { label: "AI assistant", icon: "✧", href: "/dashboard/ai-assistant", key: "assistant" },
    { label: "AI agents", icon: "✺", href: "/dashboard/agents", key: "agents" },
    { label: "Templates", icon: "▧", href: "/dashboard/templates", key: "templates" },
  ] },
  { label: "CONNECT", items: [
    { label: "Integrations", icon: "⌘", href: "/dashboard/integrations", key: "integrations" },
    { label: "Connected accounts", icon: "↗", href: "/dashboard/connections", key: "connections" },
  ] },
  { label: "MANAGE", items: [
    { label: "Real Estate", icon: "⌂", href: "/dashboard/real-estate", key: "realestate" },
    { label: "Analytics", icon: "▥", href: "/dashboard/analytics", key: "analytics" },
    { label: "Billing", icon: "◇", href: "/dashboard/billing", key: "billing" },
    { label: "Settings", icon: "⚙", href: "/dashboard/settings", key: "settings" },
  ] },
] as const;

export default function DashboardSidebar({ activePage, workspaceName = "Your workspace" }: { activePage: ActivePage; workspaceName?: string }) {
  return <aside className="sidebar">
    <Link className="dash-brand" href="/" aria-label="Rexnora home"><img src="/rexnora-lockup.svg" alt="Rexnora" style={{ width: "146px", height: "30px", objectFit: "contain" }} /></Link>
    <div className="workspace-switch"><span className="workspace-avatar">{workspaceName.slice(0, 1).toUpperCase()}</span><span className="workspace-copy"><strong>{workspaceName}</strong><small>Workspace</small></span><span className="switch-chevron">⌄</span></div>
    <nav className="side-nav dashboard-nav" aria-label="Workspace navigation">
      {groups.map(group => <section className="dashboard-nav-group" key={group.label} aria-label={group.label}>
        <div className="sidebar-label">{group.label}</div>
        {group.items.map(item => <Link key={item.key} href={item.href} aria-current={activePage === item.key ? "page" : undefined} className={activePage === item.key ? "side-link selected" : "side-link"}><span className="side-icon">{item.icon}</span>{item.label}</Link>)}
      </section>)}
    </nav>
    <div className="sidebar-bottom"><div className="help-card"><span className="help-icon">✳</span><strong>Build with confidence</strong><p>Describe the outcome, review the workflow, then activate when everything is ready.</p><Link href="/dashboard/builder">Open builder ↗</Link></div></div>
  </aside>;
}
