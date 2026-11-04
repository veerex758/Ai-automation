"use client";

import { useEffect, useMemo, useState } from "react";

type Operation = { id: string; name: string; description: string };
type RegistryNode = {
  id: string; name: string; icon: string; category: string; version: number;
  auth: { type: "none" | "oauth2" | "apiKey" | "connectionString" };
  triggers: Operation[]; actions: Operation[];
};
type ConnectionState = "connected" | "not-connected" | "unverified";
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
  email: { slug: "resend", label: "Resend" },
  gmail: { slug: "gmail", label: "Gmail" },
  google_sheets: { slug: "googlesheets", label: "Google Sheets" },
  notion: { slug: "notion", label: "Notion" },
  hubspot: { slug: "hubspot", label: "HubSpot" },
  twilio: { slug: "twilio", label: "Twilio" },
  shopify: { slug: "shopify", label: "Shopify" },
  stripe: { slug: "stripe", label: "Stripe" },
  linear: { slug: "linear", label: "Linear" },
};
const providerForNode: Record<string, string> = {

  gmail: "google:gmail", google_sheets: "google:sheets",
  email: "resend", webhooks: "webhooks", manual: "manual",
};
const connectionRequired = (node: RegistryNode) => node.auth.type !== "none";

function connectionState(node: RegistryNode, workspace: ConnectionRecord[], google: ConnectionRecord[], failed: boolean): ConnectionState {
  if (!connectionRequired(node)) return "connected";
  if (failed) return "unverified";
  if (node.id === "gmail" || node.id === "google_sheets") {
    const product = node.id === "gmail" ? "gmail" : "sheets";
    return google.some((item) => item.product === product && item.status === "connected") ? "connected" : "not-connected";
  }
  if (node.id === "webhooks") return "not-connected";
  const provider = providerForNode[node.id] ?? node.id;
  const record = workspace.find((item) => item.provider === provider);
  if (!record) return "not-connected";
  return record.status === "connected" && record.last_test_status === "success" ? "connected" : "not-connected";
}

function BrandMark({ node }: { node: RegistryNode }) {
  const asset = officialBrandAssets[node.id];
  if (asset) {
    return <span className="integration-brand-mark official-brand-mark">
      <img
        src={`https://cdn.simpleicons.org/${asset.slug}`}
        alt={`${asset.label} logo`}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
      />
    </span>;
  }
  return <span className={"integration-brand-mark registry-native-mark native-" + node.id} aria-hidden="true">
    {node.id === "manual" ? "▶" : node.id === "webhooks" ? "↗" : node.name.slice(0, 1).toUpperCase()}
  </span>;
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
    const haystack = [node.name, node.id, node.category, ...node.actions.map((item) => item.name), ...node.triggers.map((item) => item.name)].join(" ").toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  }), [nodes, query]);

  const connectedCount = nodes.filter((node) => connectionState(node, workspace, google, statusUnavailable) === "connected" && connectionRequired(node)).length;
  const toggle = (id: string) => setExpanded((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);

  return <section className="registry-integrations" aria-label="Registered integrations">
    <div className="registry-directory-toolbar">
      <div><strong>{nodes.length} registered nodes</strong><span>{connectedCount} verified connections</span></div>
      <label className="registry-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search integrations or operations" aria-label="Search integrations or operations" /></label>
    </div>
    {catalogState === "loading" && <div className="registry-state-panel">Loading the registered node catalog…</div>}
    {catalogState === "error" && <div className="registry-state-panel" role="alert">The node registry could not be loaded. Integration cards are hidden rather than showing an incomplete catalogue.</div>}
    {catalogState === "ready" && <div className="registry-node-grid">
      {filtered.map((node) => {
        const state = connectionState(node, workspace, google, statusUnavailable);
        const isExpanded = expanded.includes(node.id);
        const operations = [...node.triggers.map((operation) => ({ ...operation, kind: "Trigger" })), ...node.actions.map((operation) => ({ ...operation, kind: "Action" }))];
        return <article className="registry-node-card" key={node.id}>
          <div className="registry-node-heading"><BrandMark node={node} /><div className="registry-node-name"><h3>{node.name}</h3><span>{node.category} · v{node.version}</span></div>
            <span className={"registry-connection-state state-" + state}>{!connectionRequired(node) ? "No connection needed" : state === "connected" ? "Connected" : state === "not-connected" ? "Not connected" : "Status unavailable"}</span>
          </div>
          <p className="registry-node-summary">{operations.length} available {operations.length === 1 ? "operation" : "operations"} · {node.auth.type === "none" ? "No credentials required" : node.auth.type === "oauth2" ? "Google authorization" : "Workspace credentials"}</p>
          <div className="registry-operation-preview">{operations.slice(0, 2).map((operation) => <span key={operation.id}>{operation.name}</span>)}{operations.length > 2 && <span>+{operations.length - 2} more</span>}</div>
          <button className="registry-expand-button" type="button" aria-expanded={isExpanded} onClick={() => toggle(node.id)}>{isExpanded ? "Hide operations" : "View operations"} <span>{isExpanded ? "−" : "+"}</span></button>
          {isExpanded && <div className="registry-operation-list">{operations.length === 0 ? <p>No trigger or action operations are registered yet.</p> : operations.map((operation) => <div className="registry-operation" key={operation.kind + operation.id}><div><span>{operation.kind}</span><strong>{operation.name}</strong><code>{operation.id}</code></div><p>{operation.description}</p></div>)}</div>}
        </article>;
      })}
      {filtered.length === 0 && <div className="registry-state-panel">No registered integration or operation matches “{query}”.</div>}
    </div>}
    <p className="registry-directory-note">Connection status is sourced from saved workspace records and successful provider checks. Registry availability alone never means an account is connected. Credential-free nodes are labeled separately.</p>
  </section>;
}
