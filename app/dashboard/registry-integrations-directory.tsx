"use client";

import { useEffect, useMemo, useState } from "react";

type Operation = { id: string; name: string; description: string };
type RegistryNode = {
  id: string; name: string; icon: string; category: string; group: string; version: number;
  executionStatus: "available" | "coming_soon";
  auth: { type: "none" | "oauth2" | "apiKey" | "connectionString" };
  triggers: Operation[]; actions: Operation[];
};
type ConnectionState = "connected" | "not-connected" | "unverified" | "coming-soon" | "no-connection";
type ConnectionRecord = {
  provider: string; status?: string | null; last_test_status?: string | null;
  last_tested_at?: string | null; account_email?: string | null; product?: string;
};
type CatalogPayload = { nodes?: RegistryNode[]; error?: string };
type WorkspacePayload = { integrations?: ConnectionRecord[]; error?: string };
type GooglePayload = { connections?: ConnectionRecord[]; error?: string };

const officialBrandAssets: Record<string, { slug: string; label: string }> = {
  openai: { slug: "openai", label: "OpenAI" },
  gemini: { slug: "googlegemini", label: "Google Gemini" },
  slack: { slug: "slack", label: "Slack" },
  resend: { slug: "resend", label: "Resend" },
  gmail: { slug: "gmail", label: "Gmail" },
  google_sheets: { slug: "googlesheets", label: "Google Sheets" },
  notion: { slug: "notion", label: "Notion" },
  hubspot: { slug: "hubspot", label: "HubSpot" },
  twilio_sms: { slug: "twilio", label: "Twilio" },
  shopify: { slug: "shopify", label: "Shopify" },
  stripe: { slug: "stripe", label: "Stripe" },
  linear: { slug: "linear", label: "Linear" },
};
const providerForNode: Record<string, string> = {
  gmail: "google:gmail",
  google_sheets: "google:sheets",
  resend: "resend",
  webhook_trigger: "webhooks",
  manual_trigger: "manual",
  twilio_sms: "twilio",
};
const connectionRequired = (node: RegistryNode) => node.auth.type !== "none";

function connectionState(node: RegistryNode, workspace: ConnectionRecord[], google: ConnectionRecord[], failed: boolean): ConnectionState {
  if (node.executionStatus !== "available") return "coming-soon";
  if (!connectionRequired(node)) return "no-connection";
  if (failed) return "unverified";
  if (node.id === "gmail" || node.id === "google_sheets") {
    const product = node.id === "gmail" ? "gmail" : "sheets";
    return google.some((item) => item.product === product && item.status === "connected") ? "connected" : "not-connected";
  }
  const provider = providerForNode[node.id] ?? node.id;
  const record = workspace.find((item) => item.provider === provider);
  if (!record) return "not-connected";
  return record.status === "connected" && record.last_test_status === "success" ? "connected" : "not-connected";
}

function BrandMark({ node }: { node: RegistryNode }) {
  const asset = officialBrandAssets[node.id];
  if (asset) {
    return <span className="integration-brand-mark official-brand-mark">
      <img src={`https://cdn.simpleicons.org/${asset.slug}`} alt={`${asset.label} logo`} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
    </span>;
  }
  return <span className={"integration-brand-mark registry-native-mark native-" + node.id} aria-hidden="true">
    {node.name.slice(0, 1).toUpperCase()}
  </span>;
}

function stateLabel(state: ConnectionState) {
  switch (state) {
    case "connected": return "Connected · verified";
    case "not-connected": return "Connect account";
    case "unverified": return "Status unavailable";
    case "coming-soon": return "Coming soon";
    case "no-connection": return "No account connection";
  }
}

export default function RegistryIntegrationsDirectory() {
  const [nodes, setNodes] = useState<RegistryNode[]>([]);
  const [workspace, setWorkspace] = useState<ConnectionRecord[]>([]);
  const [google, setGoogle] = useState<ConnectionRecord[]>([]);
  const [catalogState, setCatalogState] = useState<"loading" | "ready" | "error">("loading");
  const [statusUnavailable, setStatusUnavailable] = useState(false);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    async function load() {
      const [catalogResponse, workspaceResponse, googleResponse] = await Promise.all([
        fetch("/api/integrations/catalog", { cache: "no-store" }),
        fetch("/api/integrations/workspace", { cache: "no-store" }),
        fetch("/api/integrations/google/connections", { cache: "no-store" }),
      ]);
      const [catalogData, workspaceData, googleData] = await Promise.all([
        catalogResponse.json().catch(() => ({})) as Promise<CatalogPayload>,
        workspaceResponse.json().catch(() => ({})) as Promise<WorkspacePayload>,
        googleResponse.json().catch(() => ({})) as Promise<GooglePayload>,
      ]);
      if (!active) return;
      if (!catalogResponse.ok || !Array.isArray(catalogData.nodes)) setCatalogState("error");
      else { setNodes(catalogData.nodes); setCatalogState("ready"); }
      if (!workspaceResponse.ok || !googleResponse.ok) setStatusUnavailable(true);
      setWorkspace(Array.isArray(workspaceData.integrations) ? workspaceData.integrations : []);
      setGoogle(Array.isArray(googleData.connections) ? googleData.connections : []);
    }
    void load().catch(() => { if (active) { setCatalogState("error"); setStatusUnavailable(true); } });
    return () => { active = false; };
  }, []);

  const filtered = useMemo(() => nodes.filter((node) => {
    const haystack = [node.name, node.id, node.category, node.group, ...node.actions.map((item) => item.name), ...node.triggers.map((item) => item.name)].join(" ").toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  }), [nodes, query]);

  const connectedCount = nodes.filter((node) => connectionState(node, workspace, google, statusUnavailable) === "connected").length;
  const availableCount = nodes.filter((node) => node.executionStatus === "available").length;
  const toggle = (id: string) => setExpanded((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);

  return <section className="registry-integrations" aria-label="Aivanta provider directory">
    <div className="registry-directory-toolbar">
      <div>
        <strong>{nodes.length} providers</strong>
        <span>{availableCount} execution-ready · {connectedCount} verified connections</span>
      </div>
      <label className="registry-search">
        <span aria-hidden="true">⌕</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search providers or operations" aria-label="Search providers or operations" />
      </label>
    </div>
    {catalogState === "loading" && <div className="registry-state-panel">Loading the provider directory…</div>}
    {catalogState === "error" && <div className="registry-state-panel" role="alert">The provider directory could not be loaded. Entries are hidden rather than showing an incomplete catalogue.</div>}
    {catalogState === "ready" && <div className="registry-node-grid">
      {filtered.map((node) => {
        const state = connectionState(node, workspace, google, statusUnavailable);
        const isExpanded = expanded.includes(node.id);
        const operations = [...node.triggers.map((operation) => ({ ...operation, kind: "Trigger" })), ...node.actions.map((operation) => ({ ...operation, kind: "Action" }))];
        return <article className="registry-node-card" key={node.id}>
          <div className="registry-node-heading">
            <BrandMark node={node} />
            <div className="registry-node-name"><h3>{node.name}</h3><span>{node.group} · v{node.version}</span></div>
            <span className={"registry-connection-state state-" + state}>{stateLabel(state)}</span>
          </div>
          <p className="registry-node-summary">
            {node.executionStatus === "available"
              ? `${operations.length} registered ${operations.length === 1 ? "operation" : "operations"} · ${node.auth.type === "none" ? "No account credentials" : node.auth.type === "oauth2" ? "OAuth authorization" : node.auth.type === "connectionString" ? "Encrypted connection string" : "Workspace credentials"}`
              : "Provider listed · execution adapter and security checks not yet enabled"}
          </p>
          {node.executionStatus === "available" && <div className="registry-operation-preview">
            {operations.slice(0, 2).map((operation) => <span key={operation.kind + operation.id}>{operation.name}</span>)}
            {operations.length > 2 && <span>+{operations.length - 2} more</span>}
          </div>}
          {node.executionStatus === "available" && <button className="registry-expand-button" type="button" aria-expanded={isExpanded} onClick={() => toggle(node.id)}>
            {isExpanded ? "Hide operations" : "View operations"} <span>{isExpanded ? "−" : "+"}</span>
          </button>}
          {isExpanded && <div className="registry-operation-list">
            {operations.length === 0 ? <p>No operations are registered yet.</p> : operations.map((operation) => <div className="registry-operation" key={operation.kind + operation.id}>
              <div><span>{operation.kind}</span><strong>{operation.name}</strong><code>{operation.id}</code></div><p>{operation.description}</p>
            </div>)}
          </div>}
        </article>;
      })}
      {filtered.length === 0 && <div className="registry-state-panel">No provider or operation matches “{query}”.</div>}
    </div>}
    <p className="registry-directory-note">
      All 100 requested providers are listed. “Coming soon” means no native execution adapter is registered yet; it is not a working connection. Only registry-backed operations can be selected by the AI planner or execution engine. A connected label requires a saved workspace connection and a successful provider test.
    </p>
  </section>;
}
