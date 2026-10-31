"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

const integrations = [
  { name: "Slack", category: "Communication", symbol: "✳", tone: "violet", description: "Send reviewed team notifications through a configured Slack webhook.", capability: "Webhook action" },
  { name: "HTTP API", category: "Developer tools", symbol: "↗", tone: "blue", description: "Call approved HTTPS endpoints with controlled request settings.", capability: "HTTP request action" },
];

export default function IntegrationDirectory() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const categories = ["All", ...Array.from(new Set(integrations.map(item => item.category)))];
  const visible = useMemo(() => integrations.filter(item =>
    (category === "All" || item.category === category)
    && `${item.name} ${item.description} ${item.category}`.toLowerCase().includes(search.toLowerCase())
  ), [category, search]);

  return <section className="integration-directory">
    <div className="integration-directory-tools">
      <label className="integration-search"><span aria-hidden="true">⌕</span><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search integrations" aria-label="Search integrations"/></label>
      <div className="integration-categories" aria-label="Filter integrations">
        {categories.map(item=><button key={item} type="button" className={category===item?"active":""} onClick={()=>setCategory(item)}>{item}</button>)}
      </div>
    </div>
    {visible.length ? <div className="section-cards-grid">{visible.map(item=><article className="section-info-card integration-directory-card" key={item.name}>
      <div className={`workflow-app-icon ${item.tone}`}>{item.symbol}</div>
      <div className="section-card-title"><h3>{item.name}</h3><span className="workflow-status status-draft"><i/>Setup required</span></div>
      <p>{item.description}</p><small>{item.capability} · Connection is configured per workflow; it is not a connected account yet.</small>
      <Link className="section-card-link" href="/dashboard/builder">Configure in builder ↗</Link>
    </article>)}</div> : <div className="section-empty-panel"><h3>No matching integrations</h3><p>Try another search or category.</p><button className="subtle-button" type="button" onClick={()=>{setSearch("");setCategory("All");}}>Clear filters</button></div>}
  </section>;
}
