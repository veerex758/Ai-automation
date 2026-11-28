import Link from "next/link";

const features = [
  ["↗", "Capture every enquiry", "Bring leads and requests into one connected workflow."],
  ["✧", "Let AI handle the first pass", "Organize incoming information and prepare useful summaries for your team."],
  ["⌁", "Connect the tools you use", "Move information between your apps without repetitive copy and paste."],
  ["✓", "Keep people in control", "Review, test and approve workflows before they run."],
  ["◷", "Know what happened", "Follow workflow activity and see where a run needs attention."],
  ["▣", "Build around your process", "Start with a simple automation and expand as your needs grow."]
];

function Brand() {
  return <Link className="rx-brand" href="/" aria-label="Rexnora home">
    <img className="rx-lockup" src="/rexnora-lockup.svg" alt="Rexnora"/>
  </Link>;
}

function DashboardPreview() {
 return <div className="rx-dashboard-preview" aria-label="Illustrative Rexnora dashboard preview">
  <aside className="rx-preview-sidebar">
   <Brand/>
   <div className="rx-preview-nav">
    {["⌂|Dashboard","♧|Automations","⚙|Integrations","♙|Marketplace","✧|AI Agent","▥|Analytics","▣|Billing","⚙|Settings"].map((item,i)=><div className={i===0?"active":""} key={item}><span>{item.split("|")[0]}</span>{item.split("|")[1]}</div>)}
   </div>
   <div className="rx-upgrade"><span>✦ Make work flow</span><p>Less busywork. More momentum.</p><b>Get Started →</b></div>
  </aside>
  <div className="rx-preview-main">
   <div className="rx-preview-top"><div className="rx-search"><span>⌕</span>Search workflows...<kbd>⌘ K</kbd></div><div className="rx-top-actions"><span>♧</span><i>R</i></div></div>
   <section className="rx-welcome-panel">
    <div className="rx-welcome-copy"><span className="rx-welcome-chip">✦ Your work, connected</span><h2>Automate smarter,<br/><em>move faster.</em></h2><p>Connect your tools. Build a workflow.<br/>Keep every step in view.</p><div><Link href="/dashboard/playbooks/new">Create a Playbook →</Link><Link href="/dashboard/templates">Explore Templates</Link></div></div>
    <div className="rx-orbit-art"><span className="rx-orbit-ring"/><img src="/rexnora-mark.svg" alt="Rexnora mark"/></div>
   </section>
   <div className="rx-preview-stats">
    <article><span className="rx-stat-icon">ϟ</span><div><strong>Workflows</strong><small>Build repeatable processes</small></div></article>
    <article><span className="rx-stat-icon lavender">▷</span><div><strong>Connected apps</strong><small>Bring your tools together</small></div></article>
    <article><span className="rx-stat-icon success">✓</span><div><strong>Run history</strong><small>See what happened</small></div></article>
   </div>
  </div>
 </div>
}

function AutomationShowcase() {
 return <section className="rx-brand-panel rx-automation-panel" aria-labelledby="automation-heading">
  <div className="rx-panel-heading">
   <span className="rx-automation-eyebrow">FROM MANUAL TASKS TO MOMENTUM</span>
   <h2 id="automation-heading">Let your workflow do the busywork.</h2>
   <p>Turn the steps your team repeats every day into connected automations you can review and control.</p>
  </div>
  <div className="rx-automation-flow" aria-label="Example lead qualification workflow">
   <article><span className="rx-flow-number">01</span><div><strong>New enquiry arrives</strong><small>A lead comes in from your chosen channel</small></div><span className="rx-flow-symbol">↘</span></article>
   <article><span className="rx-flow-number">02</span><div><strong>AI organizes the details</strong><small>Key information is summarized for your team</small></div><span className="rx-flow-symbol">✧</span></article>
   <article><span className="rx-flow-number">03</span><div><strong>Your team gets the next step</strong><small>A clear update is sent to the right place</small></div><span className="rx-flow-symbol">→</span></article>
   <article><span className="rx-flow-number">04</span><div><strong>The outcome is recorded</strong><small>Track what ran and what needs attention</small></div><span className="rx-flow-symbol">✓</span></article>
  </div>
  <div className="rx-automation-note"><span>✦</span><p><strong>You stay in control.</strong> Review the workflow, test it safely and activate it when it is ready.</p></div>
 </section>
}

export default function Home() {
 return <main className="rx-home" style={{ fontFamily: "'Geist', 'Inter', sans-serif" }}>
  <section className="rx-top">
   <div className="rx-hero">
    <div className="rx-hero-art rx-hero-art-one"/><div className="rx-hero-art rx-hero-art-two"/>
    <Brand/>
    <h1>Intelligence in <span>motion.</span></h1>
    <p>Describe it. Build it. Run it.</p>
    <div className="rx-hero-actions"><Link href="/dashboard">Get Started <span>→</span></Link><Link href="#platform">Explore Platform</Link></div>
   </div>
   <AutomationShowcase/>
  </section>
  <section className="rx-lower" id="platform">
   <DashboardPreview/>
   <div className="rx-platform-copy"><span className="rx-automation-eyebrow">ONE PLATFORM. LESS BUSYWORK.</span><h2>Build. Automate. <span>Scale.</span></h2><p>Bring your everyday tools and processes together. Let Rexnora help turn repetitive work into workflows your team can understand and control.</p><div className="rx-accent-rule"/><div className="rx-feature-grid">{features.map(([icon,title,description])=><article key={title}><span>{icon}</span><b>{title}</b><small>{description}</small></article>)}</div><Link className="rx-platform-cta" href="/dashboard/playbooks/new">Create your first Playbook <span>→</span></Link></div>
  </section>
 </main>;
}
