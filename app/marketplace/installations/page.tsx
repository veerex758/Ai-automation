import Link from "next/link";
import {redirect} from "next/navigation";
import {createClient} from "@/lib/supabase/server";
import MarketplaceInstallationManager from "./installation-manager";
import "../marketplace.css";

export default async function MarketplaceInstallationsPage(){
 const sb=await createClient();
 const {data:{user}}=await sb.auth.getUser();
 if(!user)redirect("/login?next=/marketplace/installations");
 const {data,error}=await sb.from("marketplace_installations")
  .select("id,status,product_version_id,installed_at,product:marketplace_products(name,slug),version:marketplace_product_versions(version)")
  .eq("installed_by",user.id).neq("status","removed").order("installed_at",{ascending:false}).limit(100);
 const installations=(data??[]) as unknown as Array<{id:string;status:string;product_version_id:string;installed_at:string;product:{name:string;slug:string}|null;version:{version:string}|null}>;
 return <main className="marketplace-shell"><header className="marketplace-header"><Link href="/marketplace" className="marketplace-brand"><img src="/aivanta-mark.svg" alt=""/> Aivanta <span>Marketplace</span></Link><nav><Link href="/marketplace">Catalog</Link><Link href="/marketplace/purchases">Purchases</Link><Link href="/dashboard">Dashboard</Link></nav></header><section className="marketplace-products"><div className="marketplace-section-head"><div><small>YOUR WORKSPACE</small><h1>Installed products</h1><p>Manage versions, connections, testing and activation for Marketplace workflows.</p></div><span className="marketplace-count">{installations.length} installed</span></div>{error?<div className="marketplace-empty"><h3>Installations unavailable</h3><p>We could not load your installed products.</p></div>:installations.length?installations.map(i=><MarketplaceInstallationManager key={i.id} installationId={i.id} productName={i.product?.name??"Marketplace product"} version={i.version?.version??"Pinned version"} initialStatus={i.status}/>):<div className="marketplace-empty"><h3>No installed products</h3><p>Install a verified workflow from the Marketplace to manage it here.</p><Link href="/marketplace">Explore Marketplace →</Link></div>}</section><footer className="marketplace-footer">© Aivanta · Marketplace</footer></main>;
}
