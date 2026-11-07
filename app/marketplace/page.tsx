import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import "./marketplace.css";

type Product = {
 id:string;slug:string;name:string;summary:string;product_type:string;pricing_type:string;price_minor:number;currency:string;
 category?:{name:string;slug:string}|null;creator?:{display_name:string;slug:string}|null;
};
const money=(minor:number,currency:string)=>new Intl.NumberFormat("en-US",{style:"currency",currency,maximumFractionDigits:minor%100===0?0:2}).format(minor/100);
export default async function MarketplacePage(){
 let products:Product[]=[];let categories:{name:string;slug:string}[]=[];
 try{
  const supabase=await createClient();
  const [p,c]=await Promise.all([
   supabase.from("marketplace_products").select("id,slug,name,summary,product_type,pricing_type,price_minor,currency,category:marketplace_categories(name,slug),creator:marketplace_creators(display_name,slug)").eq("status","published").order("published_at",{ascending:false}).limit(24),
   supabase.from("marketplace_categories").select("name,slug").eq("is_active",true).order("sort_order")
  ]);
  if(!p.error)products=(p.data??[]) as unknown as Product[];
  if(!c.error)categories=c.data??[];
 }catch{}
 return <main className="marketplace-shell">
  <header className="marketplace-header"><Link href="/" className="marketplace-brand"><img src="/aivanta-mark.svg" alt=""/> Aivanta <span>Marketplace</span></Link><nav><Link href="/pricing">Pricing</Link><Link href="/dashboard">Dashboard</Link><Link className="marketplace-submit" href="/marketplace/creator">Become a creator ↗</Link></nav></header>
  <section className="marketplace-hero"><div className="marketplace-eyebrow"><span/> VERIFIED AUTOMATIONS</div><h1>Workflows that work.<br/><em>Verified by Aivanta.</em></h1><p>Discover trusted automations and AI agents. Install, connect your accounts, test safely, and launch with confidence.</p><div className="marketplace-search"><span>⌕</span><input aria-label="Search marketplace" placeholder="Search automations, agents, integrations…"/><button type="button">Search</button></div><div className="marketplace-trust">✓ Every published product is reviewed &nbsp; · &nbsp; Workspace-safe installs &nbsp; · &nbsp; Creator-powered</div></section>
  <section className="marketplace-categories"><div><small>EXPLORE</small><h2>Find your next automation</h2></div><div className="marketplace-category-list">{categories.map(c=><Link key={c.slug} href={`/marketplace?category=${c.slug}`}>{c.name} <span>↗</span></Link>)}</div></section>
  <section className="marketplace-products"><div className="marketplace-section-head"><div><small>THE CATALOG</small><h2>Verified for your workflow</h2></div><span className="marketplace-count">{products.length} products</span></div>
   {products.length?<div className="marketplace-grid">{products.map(p=><article className="marketplace-card" key={p.id}><div className="marketplace-card-top"><span className="marketplace-type">{p.product_type.replace("_"," ")}</span><span className="marketplace-verified">✓ Aivanta verified</span></div><div className="marketplace-product-art"><span>{p.product_type==="agent"?"✳":p.product_type==="pack"?"▦":"⌘"}</span></div><div className="marketplace-card-body"><small>{p.category?.name??"Automation"}</small><h3>{p.name}</h3><p>{p.summary}</p><div className="marketplace-card-bottom"><span>{p.pricing_type==="free"?"Free":money(p.price_minor,p.currency)}{p.pricing_type==="recurring"?" / month":""}</span><Link href={`/marketplace/${p.slug}`}>View product ↗</Link></div><div className="marketplace-creator">by {p.creator?.display_name??"Aivanta"}</div></div></article>)}</div>:<div className="marketplace-empty"><div>✧</div><h3>Verified products are on their way</h3><p>Every listing goes through Aivanta's automated checks and human review before it appears here. We're preparing the first collection.</p><Link href="/marketplace/creator">Submit an automation for review →</Link></div>}
  </section>
  <section className="marketplace-creator-cta"><div><small>BUILD. VERIFY. EARN.</small><h2>Your automation could help<br/>thousands of businesses.</h2><p>Publish your work, pass Aivanta verification, and earn 80% of eligible product sales.</p></div><Link href="/marketplace/creator">Start publishing ↗</Link></section>
  <footer className="marketplace-footer">© Aivanta · Marketplace · Trust is built into every install.</footer>
 </main>;
}
