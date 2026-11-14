import Link from "next/link";

const swatches = [
  ["Obsidian", "#0B0F14", "Primary"], ["Slate", "#1A1F29", "Surface"],
  ["Charcoal", "#2A2F3A", "Borders"], ["Royal Blue", "#3B82F6", "Accent"],
  ["Lavender", "#8B5CF6", "Accent"], ["Ivory", "#F8FAFC", "Text"],
  ["Muted", "#94A3B8", "Text"],
];
const values = [["ϟ","Powerful"],["♢","Trusted"],["◇","Elegant"],["▱","Scalable"],["☻","Approachable"]];
const features = [["⌘","Workflows","& Automations"],["♧","AI-Powered","Assistance"],["♧","Powerful","Integrations"],["⬡","Marketplace",""],["‹ ›","Developer","Platform"],["▱","Enterprise Ready",""]];

function Brand({ compact = false }: { compact?: boolean }) {
  return <Link className={compact ? "rx-brand rx-brand-compact" : "rx-brand"} href="/" aria-label="Rexnora home">
    <span className="rx-mark"><img src="/rexnora-mark.svg" alt="" /></span><span className="rx-wordmark">REXNORA</span>
  </Link>;
}

function DashboardPreview() {
 return <div className="rx-dashboard-preview" aria-label="Illustrative Rexnora dashboard preview">
  <aside className="rx-preview-sidebar">
   <Brand compact />
   <div className="rx-preview-nav">
    {["⌂|Dashboard","♧|Automations","⚙|Integrations","♙|Marketplace","✧|AI Agent","▥|Analytics","▣|Billing","⚙|Settings"].map((item,i)=><div className={i===0?"active":""} key={item}><span>{item.split("|")[0]}</span>{item.split("|")[1]}</div>)}
   </div>
   <div className="rx-upgrade"><span>✦ Upgrade to Pro</span><p>Unlock more power.</p><b>Upgrade Now →</b></div>
  </aside>
  <div className="rx-preview-main">
   <div className="rx-preview-top"><div className="rx-search"><span>⌕</span>Search anything...<kbd>⌘ K</kbd></div><div className="rx-top-actions"><span>♧</span><i>R</i></div></div>
   <section className="rx-welcome-panel">
    <div className="rx-welcome-copy"><span className="rx-welcome-chip">✦ Welcome back!</span><h2>Automate smarter,<br/><em>Grow faster.</em></h2><p>Create powerful workflows, connect your tools,<br/>and let REXNORA handle the rest.</p><div><Link href="/dashboard">Create Workflow →</Link><Link href="/dashboard/templates">Explore Templates</Link></div></div>
    <div className="rx-orbit-art"><span className="rx-orbit-ring"/><img src="/rexnora-mark.svg" alt="Rexnora mark"/></div>
   </section>
   <div className="rx-preview-stats">
    <article><span className="rx-stat-icon">ϟ</span><div><strong>12</strong><small>Active Workflows</small></div><em>↑ +20%</em></article>
    <article><span className="rx-stat-icon lavender">▷</span><div><strong>8.4K</strong><small>Executions</small></div><em>↑ +12%</em></article>
    <article><span className="rx-stat-icon success">✓</span><div><strong>99.9%</strong><small>Success Rate</small></div><em>↑ +0.1%</em></article>
   </div>
  </div>
 </div>
}

export default function Home() {
 return <main className="rx-home">
  <section className="rx-top">
   <div className="rx-hero">
    <div className="rx-hero-art rx-hero-art-one"/><div className="rx-hero-art rx-hero-art-two"/>
    <Brand />
    <h1>Intelligence in <span>motion.</span></h1>
    <p>Describe it. Build it. Run it.</p>
    <div className="rx-hero-actions"><Link href="/dashboard">Get Started <span>→</span></Link><Link href="#platform">Explore Platform</Link></div>
   </div>
   <aside className="rx-brand-panel">
    <div className="rx-panel-heading"><h2>Brand Colour System</h2><p>A refined palette for a premium experience.</p></div>
    <div className="rx-swatches">{swatches.map(([name,hex,role])=><div className="rx-swatch" key={name}><span style={{background:hex,borderColor:name==="Obsidian"?"#3A4250":"transparent"}}/><strong>{name}</strong><code>{hex}</code><small>({role})</small></div>)}</div>
    <div className="rx-type-section"><h2>Typography</h2><p>Clean. Modern. Highly readable.</p><div className="rx-type-pair"><div><strong>Aa</strong><span><b>Inter</b><small>Headings &amp; UI</small></span></div><div><strong>Aa</strong><span><b>Geist</b><small>Body Text</small></span></div></div></div>
    <div className="rx-values"><h2>Brand Values</h2><div>{values.map(([icon,label])=><div key={label}><span>{icon}</span><small>{label}</small></div>)}</div></div>
   </aside>
  </section>
  <section className="rx-lower" id="platform">
   <DashboardPreview />
   <div className="rx-platform-copy"><h2>Build. Automate. <span>Scale.</span></h2><p>A next-generation automation platform<br/>for individuals, teams and businesses.</p><div className="rx-accent-rule"/><div className="rx-feature-grid">{features.map(([icon,line1,line2])=><article key={line1}><span>{icon}</span><b>{line1}{line2&&<><br/>{line2}</>}</b></article>)}</div></div>
  </section>
 </main>;
}
