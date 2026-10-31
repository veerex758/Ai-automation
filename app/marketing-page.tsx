import Link from "next/link";
import "./globals.css";

type Section="features"|"pricing"|"resources";
const metadata={
 features:{eyebrow:"THE AIVANTA PLATFORM",title:"Everything you need to automate with confidence.",description:"From plain-language workflow ideas to visual editing and controlled execution, Aivanta is designed to make automation easier to understand."},
 pricing:{eyebrow:"SIMPLE, TRANSPARENT PLANS",title:"Pricing that grows with your automation.",description:"The final subscription tiers and usage limits are still being defined. We won't show invented prices or charge anything from this preview."},
 resources:{eyebrow:"LEARN AND BUILD",title:"Resources for your next workflow.",description:"Explore the product, learn the workflow basics, and use the workspace to shape your automation ideas."}
} as const;
const featureCards=[
 ["✺","AI workflow drafting","Describe the outcome you want and review a proposed workflow before applying it."],
 ["▤","Visual workflow builder","Inspect steps, edit configuration, and validate a workflow before saving it."],
 ["⌘","Integration catalog","Review supported services, required permissions, and setup steps before connecting an account."],
 ["♧","Human-reviewed AI","Use AI-assisted planning with clear boundaries; generated steps never execute automatically."],
 ["⬟","Workspace security","Keep access scoped and protect credentials with server-side authorization and least privilege."],
 ["◷","Execution history","Review recorded workflow runs as execution capabilities become available in your workspace."]
];
export default function MarketingPage({section}:{section:Section}) {
 const meta=metadata[section];
 return <main className="reference-home marketing-subpage"><header className="reference-header"><div className="reference-nav-inner"><Link className="brand brand-light" href="/"><span className="brand-mark"><img className="brand-logo" src="/aivanta-mark.svg" alt="" aria-hidden="true"/></span><span>Aivanta</span></Link><nav className="reference-nav-links" aria-label="Main navigation"><Link href="/">Home</Link><Link className={section==="features"?"active":""} href="/features">Features</Link><Link className={section==="pricing"?"active":""} href="/pricing">Pricing</Link><Link className={section==="resources"?"active":""} href="/resources">Resources</Link></nav><div className="reference-auth"><Link className="sign-in-link" href="/login">Sign In</Link><Link className="reference-primary small" href="/dashboard">Get Started Free</Link></div></div></header>
 <section className="marketing-sub-hero"><div className="reference-eyebrow">{meta.eyebrow}</div><h1>{meta.title}</h1><p>{meta.description}</p><div className="marketing-sub-actions"><Link className="reference-primary" href="/dashboard">Open Aivanta workspace <span>→</span></Link><Link className="reference-secondary" href="/">Back to home</Link></div></section>
 {section==="features"&&<section className="marketing-sub-grid">{featureCards.map(([icon,title,description])=><article className="marketing-sub-card" key={title}><span>{icon}</span><h2>{title}</h2><p>{description}</p></article>)}</section>}
 {section==="pricing"&&<section className="marketing-sub-grid pricing-grid"><article className="marketing-sub-card"><span>01</span><h2>Starter</h2><p>Explore workflow drafts, build your first automations, and learn the platform.</p><strong>Plan details being finalized</strong></article><article className="marketing-sub-card featured-plan"><span>02</span><h2>Team</h2><p>Designed for teams that need shared workflows, collaboration, and broader automation capacity.</p><strong>Plan details being finalized</strong></article><article className="marketing-sub-card"><span>03</span><h2>Business</h2><p>For organizations with advanced control, integration and governance needs.</p><strong>Contact and billing flows not yet configured</strong></article></section>}
 {section==="resources"&&<section className="marketing-sub-grid">{[["Workflow builder","Create and inspect a workflow draft.","/dashboard/builder"],["Templates","Start from reusable workflow patterns.","/dashboard/templates"],["Integrations","Review the current integration catalog and setup requirements.","/dashboard/integrations"],["AI Assistant","Describe a workflow and review the generated draft.","/dashboard/ai-assistant"],["Analytics","Review the execution metrics available for your workspace.","/dashboard/analytics"],["Workspace settings","Learn about workspace access and configuration boundaries.","/dashboard/settings"]].map(([title,description,href])=><article className="marketing-sub-card" key={title}><span>↗</span><h2>{title}</h2><p>{description}</p><Link href={href}>Open resource ↗</Link></article>)}</section>}
 <footer className="reference-footer"><Link className="brand brand-light" href="/"><span className="brand-mark"><img className="brand-logo" src="/aivanta-mark.svg" alt="" aria-hidden="true"/></span><span>Aivanta</span></Link><span>Describe it. Build it. Trust it.</span><Link href="/dashboard">Open workspace ↗</Link></footer></main>;
}
