import Link from "next/link";

const capabilities = [
  { number: "01", title: "Workflow automation", description: "Connect the tools your team already uses and turn repetitive work into reliable, observable workflows.", icon: "↗" },
  { number: "02", title: "AI-assisted operations", description: "Bring language models into carefully defined steps, with clear inputs, outputs, and human review when it matters.", icon: "✳" },
  { number: "03", title: "Agent-ready architecture", description: "Start with predictable workflows. Add more autonomous agents as your use cases and controls mature.", icon: "⌘" },
];

const sampleSteps = [
  { label: "New lead received", app: "HubSpot", state: "Trigger", symbol: "H" },
  { label: "Enrich company details", app: "AI step", state: "Processing", symbol: "✳" },
  { label: "Create sales follow-up", app: "Salesforce", state: "Action", symbol: "S" },
];

export default function Home() {
  return (
    <main>
      <nav className="nav shell">
        <Link className="brand" href="/" aria-label="Aivanta home"><span className="brand-mark">a</span><span>Aivanta<span className="brand-period">.</span></span></Link>
        <div className="nav-links"><a href="#platform">Platform</a><a href="#how-it-works">How it works</a><a href="#security">Security</a></div>
        <a className="nav-cta" href="/dashboard">Open workspace <span>↗</span></a>
      </nav>

      <section className="hero shell">
        <div className="hero-copy">
          <div className="eyebrow"><span className="pulse" /> THE AUTOMATION PLATFORM FOR WHAT&apos;S NEXT</div>
          <h1>Less busywork.<br /><span>More business.</span></h1>
          <p className="hero-description">Bring your tools, teams, and AI together in workflows that move work forward — without adding complexity.</p>
          <div className="hero-actions"><a className="button button-dark" href="/dashboard">Explore the workspace <span>↗</span></a><a className="text-link" href="#platform">Explore the platform <span>↓</span></a></div>
          <div className="hero-proof"><div className="avatar-stack"><span>J</span><span>M</span><span>A</span><span>+</span></div><p><strong>Built for real work.</strong><br />Designed for teams that want to scale thoughtfully.</p></div>
        </div>

        <div className="preview-wrap" aria-label="Illustrative workflow preview">
          <div className="preview-glow" />
          <div className="workflow-card">
            <div className="workflow-top"><div><span className="mini-label">WORKSPACE / SALES OPS</span><h3>Lead-to-follow-up</h3></div><span className="status-pill"><i /> Draft</span></div>
            <div className="workflow-meta"><span>↗ 3 steps</span><span>◷ Updated just now</span><span className="more">•••</span></div>
            <div className="flow-list">{sampleSteps.map((step, i) => <div className="flow-item" key={step.label}><div className={"flow-icon flow-icon-" + i}>{step.symbol}</div><div className="flow-text"><strong>{step.label}</strong><span>{step.app}</span></div><span className="flow-state">{step.state}</span>{i < sampleSteps.length - 1 && <div className="flow-connector" />}</div>)}</div>
            <div className="workflow-footer"><span className="footer-check">✓</span><span>Logic you can understand. Work you can trust.</span></div>
          </div>
          <div className="floating-note note-top"><span className="note-icon">✳</span><span><strong>AI-assisted</strong><small>Where it makes sense</small></span></div>
          <div className="floating-note note-bottom"><span className="note-icon note-green">↗</span><span><strong>Designed to scale</strong><small>One workflow at a time</small></span></div>
        </div>
        <div className="hero-bottom-line"><span>CLARITY IN EVERY STEP</span><span className="line" /><span>CONTROL BY DESIGN</span><span className="line" /><span>BUILT TO GROW WITH YOU</span></div>
      </section>

      <section className="trust-strip"><div className="shell trust-inner"><span>ONE FLEXIBLE FOUNDATION FOR</span><strong>OPERATIONS</strong><strong>SALES</strong><strong>CUSTOMER SUCCESS</strong><strong>FINANCE</strong><strong>YOUR NEXT BIG IDEA</strong></div></section>

      <section className="section shell" id="platform">
        <div className="section-heading"><div><div className="eyebrow">A MORE CONNECTED WAY TO WORK</div><h2>Automation that fits<br />the way you <em>think.</em></h2></div><p>Powerful enough for technical teams. Clear enough for everyone else. Start with a simple workflow and build from there.</p></div>
        <div className="capability-grid">{capabilities.map(item => <article className="capability-card" key={item.number}><div className="capability-top"><span>{item.number}</span><span className="capability-icon">{item.icon}</span></div><h3>{item.title}</h3><p>{item.description}</p><a href="#get-started" aria-label={"Learn more about " + item.title}>Explore capability <span>↗</span></a></article>)}</div>
      </section>

      <section className="dark-section" id="how-it-works"><div className="shell dark-inner"><div><div className="eyebrow eyebrow-light">START SIMPLE. BUILD CONFIDENCE.</div><h2>Your process.<br /><span>On your terms.</span></h2><p>Describe the outcome you want. Shape the steps. Connect the tools. Keep the people in control.</p><a className="button button-light" href="#get-started">Get early access <span>↗</span></a></div><div className="principles"><div><span>01</span><p><strong>Make it visible</strong><small>Understand every step and why it runs.</small></p><span className="principle-arrow">↗</span></div><div><span>02</span><p><strong>Keep control</strong><small>Design review points around consequential actions.</small></p><span className="principle-arrow">↗</span></div><div><span>03</span><p><strong>Grow deliberately</strong><small>Expand from dependable workflows into AI-assisted operations.</small></p><span className="principle-arrow">↗</span></div></div></div></section>

      <section className="security-section shell" id="security"><div className="security-mark">⌑</div><div><div className="eyebrow">TRUST IS PART OF THE PRODUCT</div><h2>Security isn&apos;t a feature<br />you bolt on later.</h2><p>We are building around least-privilege access, careful handling of connected credentials, and clear boundaries between customer workspaces from the start.</p></div><div className="security-badge"><span>✓</span><div><strong>Security-minded by design</strong><small>Foundational principles, built in stages</small></div></div></section>

      <section className="cta-section shell" id="get-started"><div className="cta-card"><div className="eyebrow eyebrow-light">THE NEXT STEP STARTS HERE</div><h2>Give good work<br />room to happen.</h2><p>Take a closer look at the workspace and shape your first workflow. Aivanta is being built for thoughtful, controlled automation — one reliable step at a time.</p><div className="cta-actions"><a className="button button-light" href="/dashboard">Explore the workspace <span>↗</span></a><a className="cta-secondary-link" href="#how-it-works">See how it works <span>↓</span></a></div><span className="cta-decoration" aria-hidden="true">a.</span></div></section>

      <footer className="footer shell"><a className="brand" href="#"><span className="brand-mark">a</span><span>Aivanta<span className="brand-period">.</span></span></a><span>Thoughtful automation. Real work.</span><span>© {new Date().getFullYear()} Aivanta. In active development.</span></footer>
    </main>
  );
}
