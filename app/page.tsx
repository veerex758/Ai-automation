import Link from "next/link";

const features = [
  { icon: "✺", title: "AI Automation", description: "Turn your ideas into workflows using natural language." },
  { icon: "▣", title: "Visual Workflow Builder", description: "Build, edit, and manage workflows with a simple drag-and-drop editor." },
  { icon: "⌘", title: "Real Integrations", description: "Connect the apps and services your team already uses." },
  { icon: "♧", title: "AI Agents", description: "Create intelligent assistants for complex tasks, with clear human control." },
  { icon: "⬟", title: "Enterprise Security", description: "Protect your data with workspace boundaries and careful access controls." },
];

function Brand({ light = false }: { light?: boolean }) {
  return <Link className={`brand ${light ? "brand-light" : ""}`} href="/" aria-label="Aivanta home"><span className="brand-mark"><img className="brand-logo" src="/aivanta-mark.svg" alt="" aria-hidden="true" /></span><span>Aivanta</span></Link>;
}

export default function Home() {
  return (
    <main className="reference-home">
      <header className="reference-header">
        <div className="reference-nav-inner">
          <Brand light />
          <nav className="reference-nav-links" aria-label="Main navigation">
            <Link className="active" href="/">Home</Link><Link href="/features">Features</Link><Link href="/pricing">Pricing</Link><Link href="/resources">Resources <span>⌄</span></Link>
          </nav>
          <div className="reference-auth"><Link className="sign-in-link" href="/login">Sign In</Link><Link className="reference-primary small" href="/dashboard">Get Started Free</Link></div>
        </div>
      </header>

      <section className="reference-hero" aria-labelledby="hero-title">
        <div className="reference-hero-inner">
          <div className="reference-hero-copy">
            <div className="reference-eyebrow">AI-POWERED AUTOMATION PLATFORM</div>
            <h1 id="hero-title">Automate More.<br /><span>Achieve More.</span></h1>
            <p>Aivanta helps businesses create, manage, and scale powerful automations with AI. Connect your apps, build workflows, and let AI agents handle the rest.</p>
            <div className="reference-hero-actions"><Link className="reference-primary" href="/dashboard">Start Free Trial <span>→</span></Link><a className="reference-secondary" href="#product-preview"><span className="play-icon">▶</span> Watch Demo</a></div>
            <div className="reference-trust-points"><span>▣ No credit card required</span><span>♧ Secure &amp; reliable</span><span>⊘ Cancel anytime</span></div>
          </div>
          <div className="reference-hero-visual" id="product-preview">
            <div className="hero-orb" />
            <div className="floating-app-window">
              <div className="mini-sidebar"><div className="mini-brand"><img src="/aivanta-mark.svg" alt="" /> Aivanta</div><span>▦ Dashboard</span><span className="mini-active">↗ Workflows</span><span>⌘ Integrations</span><span>♧ AI Agents</span><span>▧ Templates</span><span>⚙ Settings</span></div>
              <div className="mini-workflow"><div className="mini-window-heading"><span>WORKFLOW PREVIEW</span><i>•••</i></div><div className="mini-node"><b className="node-icon form-icon">▤</b><span><strong>New Lead</strong><small>Website Form</small></span><b className="node-check">✓</b></div><div className="mini-connector">↓</div><div className="mini-node"><b className="node-icon sheets-icon">▦</b><span><strong>Add Row</strong><small>Google Sheets</small></span><b className="node-check">✓</b></div><div className="mini-connector">↓</div><div className="mini-node"><b className="node-icon gmail-icon">M</b><span><strong>Send Email</strong><small>Gmail · Welcome template</small></span><b className="node-check">✓</b></div><Link className="mini-assistant-button" href="/dashboard/ai-assistant">✺ AI Assistant <span>＋</span></Link></div>
            </div>
            <div className="reference-chat-card"><span className="chat-spark">✺</span><div><strong>AI assistant</strong><p>Create a workflow to save new leads from your website to Google Sheets and send a welcome email.</p><Link href="/dashboard/builder">Review workflow ↗</Link></div></div>
            <div className="reference-live-card"><span>✓</span><div><strong>You're in control</strong><small>Review, edit, then activate.</small></div></div>
          </div>
        </div>
      </section>

      <section className="reference-features" id="features">
        <div className="reference-section-heading"><h2>Everything You Need for Modern Business Automation</h2><p>From simple automations to intelligent AI agents, Aivanta gives you the tools to<br className="desktop-break" /> work smarter, move faster, and scale without limits.</p></div>
        <div className="reference-feature-grid">{features.map((feature) => <article className="reference-feature-card" key={feature.title}><div className="reference-feature-icon">{feature.icon}</div><h3>{feature.title}</h3><p>{feature.description}</p></article>)}</div>
      </section>

      <section className="reference-workspace-section">
        <div className="reference-workspace-copy"><div className="reference-eyebrow">ONE CLEAR VIEW OF YOUR WORK</div><h2>Your automations,<br /><span>all in one place.</span></h2><p>Track workflow health, review recent activity, and move from idea to dependable automation in one connected workspace.</p><Link className="reference-primary" href="/dashboard">Explore the dashboard <span>→</span></Link></div>
        <div className="reference-dashboard-preview">
          <div className="preview-dashboard-sidebar"><div className="mini-brand"><img src="/aivanta-mark.svg" alt="" /> Aivanta</div>{["Dashboard","Workflows","Integrations","AI Agents","Templates","Analytics","Billing","Settings"].map((item,i)=><span className={i===0?"selected":""} key={item}>{["▦","↗","⌘","✺","▧","▥","◇","⚙"][i]} {item}</span>)}</div>
          <div className="preview-dashboard-main"><div className="preview-dashboard-top"><span>⌕ Search anything...</span><span>♧　◉</span></div><div className="preview-welcome"><div><strong>Welcome back 👋</strong><small>Here's what's happening with your automation platform today.</small></div><Link href="/dashboard">＋ Create Workflow</Link></div><div className="preview-stats"><div><small>Total Workflows</small><strong>—</strong><em>Live workspace data</em></div><div><small>Active Workflows</small><strong>—</strong><em>Live workspace data</em></div><div><small>Successful Runs</small><strong>—</strong><em>Connected run history</em></div><div><small>Failed Runs</small><strong>—</strong><em>Connected run history</em></div></div><div className="preview-chart-row"><div className="preview-chart"><strong>Workflow Performance</strong><div className="chart-art"><svg viewBox="0 0 360 105" role="img" aria-label="Illustrative workflow performance chart"><path d="M0 82 C30 65 38 82 60 61 S94 70 112 40 S155 71 179 44 S210 61 235 33 S274 53 300 20 S334 22 360 8" fill="none" stroke="#b7f65c" strokeWidth="3" strokeLinecap="round"/><path d="M0 82 C30 65 38 82 60 61 S94 70 112 40 S155 71 179 44 S210 61 235 33 S274 53 300 20 S334 22 360 8 L360 105 L0 105Z" fill="url(#chartFill)" opacity=".35"/><defs><linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#9be64b"/><stop offset="1" stopColor="#9be64b" stopOpacity="0"/></linearGradient></defs></svg></div></div><div className="preview-success"><strong>Success Rate</strong><div className="success-ring"><span>—<small>Awaiting data</small></span></div></div></div><div className="preview-recent"><strong>Recent Workflows</strong><p>Connect your workspace to see real workflow status and execution history.</p><Link href="/dashboard">Open workspace ↗</Link></div></div>
        </div>
      </section>

      <footer className="reference-footer"><Brand light /><span>Describe it. Build it. Trust it.</span><span>© {new Date().getFullYear()} Aivanta</span></footer>
    </main>
  );
}
