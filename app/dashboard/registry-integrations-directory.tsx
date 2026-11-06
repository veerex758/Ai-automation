"use client";

import { useEffect, useMemo, useState } from "react";

type Operation = { id: string; name: string; description: string; inputSchema?: unknown; outputSchema?: unknown };
type RegistryNode = {
  id: string; name: string; icon: string; category: string; group: string; version: number;
  executionStatus: "registered" | "coming_soon";
  auth: { type: "none" | "oauth2" | "apiKey" | "connectionString" };
  triggers: Operation[]; actions: Operation[];
};
type ConnectionState = "connected" | "not-connected" | "unverified" | "coming-soon" | "no-connection" | "setup-required";
type ConnectionRecord = {
  provider: string; status?: string | null; last_test_status?: string | null;
  last_tested_at?: string | null; account_email?: string | null; product?: string;
};
type CatalogPayload = { nodes?: RegistryNode[]; error?: string };
type WorkspacePayload = { integrations?: ConnectionRecord[]; liveExecutionEnabled?: boolean; liveProvidersEnabled?: string[]; error?: string };
type GooglePayload = { connections?: ConnectionRecord[]; error?: string };

const officialBrandAssets: Record<string, { slug: string; label: string }> = {
  "openai": {
    "slug": "openai",
    "label": "openai"
  },
  "gemini": {
    "slug": "googlegemini",
    "label": "Google Gemini"
  },
  "slack": {
    "slug": "slack",
    "label": "slack"
  },
  "resend": {
    "slug": "resend",
    "label": "resend"
  },
  "gmail": {
    "slug": "gmail",
    "label": "gmail"
  },
  "google_sheets": {
    "slug": "googlesheets",
    "label": "Google Sheets"
  },
  "google_drive": {
    "slug": "googledrive",
    "label": "Google Drive"
  },
  "google_calendar": {
    "slug": "googlecalendar",
    "label": "Google Calendar"
  },
  "google_docs": {
    "slug": "googledocs",
    "label": "Google Docs"
  },
  "google_forms": {
    "slug": "googleforms",
    "label": "Google Forms"
  },
  "youtube": {
    "slug": "youtube",
    "label": "youtube"
  },
  "google_contacts": {
    "slug": "googlecontacts",
    "label": "Google Contacts"
  },
  "notion": {
    "slug": "notion",
    "label": "notion"
  },
  "hubspot": {
    "slug": "hubspot",
    "label": "hubspot"
  },
  "twilio_sms": {
    "slug": "twilio",
    "label": "Twilio"
  },
  "twilio_voice": {
    "slug": "twilio",
    "label": "Twilio"
  },
  "shopify": {
    "slug": "shopify",
    "label": "shopify"
  },
  "stripe": {
    "slug": "stripe",
    "label": "stripe"
  },
  "linear": {
    "slug": "linear",
    "label": "linear"
  },
  "claude": {
    "slug": "claude",
    "label": "claude"
  },
  "mistral": {
    "slug": "mistral",
    "label": "mistral"
  },
  "groq": {
    "slug": "groq",
    "label": "groq"
  },
  "perplexity": {
    "slug": "perplexity",
    "label": "perplexity"
  },
  "elevenlabs": {
    "slug": "elevenlabs",
    "label": "elevenlabs"
  },
  "stability_ai": {
    "slug": "stability",
    "label": "Stability AI"
  },
  "hugging_face": {
    "slug": "huggingface",
    "label": "Hugging Face"
  },
  "pinecone": {
    "slug": "pinecone",
    "label": "pinecone"
  },
  "discord": {
    "slug": "discord",
    "label": "discord"
  },
  "telegram": {
    "slug": "telegram",
    "label": "telegram"
  },
  "whatsapp_business": {
    "slug": "whatsapp",
    "label": "WhatsApp Business"
  },
  "microsoft_teams": {
    "slug": "microsoftteams",
    "label": "Microsoft Teams"
  },
  "sendgrid": {
    "slug": "sendgrid",
    "label": "sendgrid"
  },
  "mailgun": {
    "slug": "mailgun",
    "label": "mailgun"
  },
  "postmark": {
    "slug": "postmark",
    "label": "postmark"
  },
  "salesforce": {
    "slug": "salesforce",
    "label": "salesforce"
  },
  "pipedrive": {
    "slug": "pipedrive",
    "label": "pipedrive"
  },
  "zoho_crm": {
    "slug": "zoho",
    "label": "Zoho CRM"
  },
  "freshsales": {
    "slug": "freshworks",
    "label": "Freshsales"
  },
  "close": {
    "slug": "close",
    "label": "close"
  },
  "apollo": {
    "slug": "apollo",
    "label": "apollo"
  },
  "intercom": {
    "slug": "intercom",
    "label": "intercom"
  },
  "jira": {
    "slug": "jira",
    "label": "jira"
  },
  "asana": {
    "slug": "asana",
    "label": "asana"
  },
  "trello": {
    "slug": "trello",
    "label": "trello"
  },
  "clickup": {
    "slug": "clickup",
    "label": "clickup"
  },
  "monday": {
    "slug": "monday",
    "label": "monday"
  },
  "todoist": {
    "slug": "todoist",
    "label": "todoist"
  },
  "airtable": {
    "slug": "airtable",
    "label": "airtable"
  },
  "github": {
    "slug": "github",
    "label": "github"
  },
  "gitlab": {
    "slug": "gitlab",
    "label": "gitlab"
  },
  "bitbucket": {
    "slug": "bitbucket",
    "label": "bitbucket"
  },
  "sentry": {
    "slug": "sentry",
    "label": "sentry"
  },
  "vercel": {
    "slug": "vercel",
    "label": "vercel"
  },
  "netlify": {
    "slug": "netlify",
    "label": "netlify"
  },
  "supabase": {
    "slug": "supabase",
    "label": "supabase"
  },
  "postgresql": {
    "slug": "postgresql",
    "label": "postgresql"
  },
  "mysql": {
    "slug": "mysql",
    "label": "mysql"
  },
  "mongodb": {
    "slug": "mongodb",
    "label": "mongodb"
  },
  "redis": {
    "slug": "redis",
    "label": "redis"
  },
  "firebase": {
    "slug": "firebase",
    "label": "firebase"
  },
  "dropbox": {
    "slug": "dropbox",
    "label": "dropbox"
  },
  "aws_s3": {
    "slug": "amazons3",
    "label": "Amazon S3"
  },
  "cloudflare_r2": {
    "slug": "cloudflare",
    "label": "Cloudflare R2"
  },
  "woocommerce": {
    "slug": "woocommerce",
    "label": "woocommerce"
  },
  "paypal": {
    "slug": "paypal",
    "label": "paypal"
  },
  "paddle": {
    "slug": "paddle",
    "label": "paddle"
  },
  "lemon_squeezy": {
    "slug": "lemonsqueezy",
    "label": "Lemon Squeezy"
  },
  "square": {
    "slug": "square",
    "label": "square"
  },
  "razorpay": {
    "slug": "razorpay",
    "label": "razorpay"
  },
  "x_twitter": {
    "slug": "x",
    "label": "X"
  },
  "linkedin": {
    "slug": "linkedin",
    "label": "linkedin"
  },
  "facebook_pages": {
    "slug": "facebook",
    "label": "Facebook Pages"
  },
  "instagram": {
    "slug": "instagram",
    "label": "instagram"
  },
  "tiktok": {
    "slug": "tiktok",
    "label": "tiktok"
  },
  "mailchimp": {
    "slug": "mailchimp",
    "label": "mailchimp"
  },
  "typeform": {
    "slug": "typeform",
    "label": "typeform"
  },
  "calendly": {
    "slug": "calendly",
    "label": "calendly"
  },
  "zendesk": {
    "slug": "zendesk",
    "label": "zendesk"
  },
  "freshdesk": {
    "slug": "freshdesk",
    "label": "freshdesk"
  },
  "zoom": {
    "slug": "zoom",
    "label": "zoom"
  },
  "cal_com": {
    "slug": "caldotcom",
    "label": "Cal.com"
  },
  "docusign": {
    "slug": "docusign",
    "label": "docusign"
  },
  "rss_feed": {
    "slug": "rss",
    "label": "RSS Feed"
  },
  "serpapi": {
    "slug": "serpapi",
    "label": "serpapi"
  },
  "openweather": {
    "slug": "openweathermap",
    "label": "OpenWeather"
  }
};
const googleProductForNode: Record<string, string> = {
  gmail: "gmail", google_sheets: "sheets", google_drive: "drive", google_calendar: "calendar",
  google_docs: "docs", google_forms: "forms", youtube: "youtube", google_contacts: "contacts",
};
const providerForNode: Record<string, string> = {
  resend: "resend", http_request: "http", webhook_trigger: "webhooks", manual_trigger: "manual",
  twilio_sms: "twilio", twilio_voice: "twilio_voice",
};
const nativeIconGlyphs: Record<string, string> = {
  webhook: "↗", "calendar-clock": "◷", play: "▶", globe: "◎", "git-branch": "⑂",
  workflow: "◇", combine: "⇄", repeat: "⟳", code: "⌘", wrench: "⚒",
  "alert-triangle": "△", "list-checks": "☷", braces: "{ }", filter: "▽", sigma: "Σ",
  timer: "◴", "list-plus": "＋", "file-json": "{ }", "calendar-days": "▦",
};
const connectionRequired = (node: RegistryNode) => node.auth.type !== "none";

function connectionState(node: RegistryNode, workspace: ConnectionRecord[], google: ConnectionRecord[], failed: boolean): ConnectionState {
  if (node.executionStatus !== "registered") return "coming-soon";
  if (node.id === "webhook_trigger") return "setup-required";
  if (!connectionRequired(node)) return "no-connection";
  if (failed) return "unverified";
  if (googleProductForNode[node.id]) {
    const product = googleProductForNode[node.id];
    return google.some((item) => item.product === product && item.status === "connected") ? "connected" : "not-connected";
  }
  const provider = providerForNode[node.id] ?? node.id;
  const record = workspace.find((item) => item.provider === provider);
  if (!record) return "not-connected";
  return record.status === "connected" && record.last_test_status === "passed" ? "connected" : "not-connected";
}

function BrandMark({ node }: { node: RegistryNode }) {
  const asset = officialBrandAssets[node.id];
  if (asset) {
    return <span className="integration-brand-mark official-brand-mark">
      <img src={`https://cdn.simpleicons.org/${asset.slug}`} alt={`${node.name} logo`} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
    </span>;
  }
  return <span className={"integration-brand-mark registry-native-mark native-" + node.id} aria-hidden="true">
    {nativeIconGlyphs[node.icon] || node.name.slice(0, 1).toUpperCase()}
  </span>;
}

function stateLabel(state: ConnectionState) {
  switch (state) {
    case "connected": return "Connected · verified";
    case "not-connected": return "Connect account";
    case "unverified": return "Status unavailable";
    case "coming-soon": return "Coming soon";
    case "no-connection": return "No account connection";
    case "setup-required": return "Endpoint setup required";
  }
}

export default function RegistryIntegrationsDirectory() {
  const [nodes, setNodes] = useState<RegistryNode[]>([]);
  const [workspace, setWorkspace] = useState<ConnectionRecord[]>([]);
  const [google, setGoogle] = useState<ConnectionRecord[]>([]);
  const [catalogState, setCatalogState] = useState<"loading" | "ready" | "error">("loading");
  const [statusUnavailable, setStatusUnavailable] = useState(false);
  const [liveExecutionEnabled, setLiveExecutionEnabled] = useState(false);
  const [liveProvidersEnabled, setLiveProvidersEnabled] = useState<string[]>([]);
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
      setLiveExecutionEnabled(workspaceData.liveExecutionEnabled === true);
      setLiveProvidersEnabled(Array.isArray(workspaceData.liveProvidersEnabled) ? workspaceData.liveProvidersEnabled : []);
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
  const registeredCount = nodes.filter((node) => node.executionStatus === "registered").length;
  const toggle = (id: string) => setExpanded((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);

  return <section className="registry-integrations" aria-label="Aivanta provider directory">
    <div className="registry-directory-toolbar">
      <div>
        <strong>{nodes.length} providers</strong>
        <span>{registeredCount} registered adapters · {connectedCount} verified connections · {liveExecutionEnabled ? "global live gate on" : "global live gate off"}</span>
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
        const providerPermissionKey = googleProductForNode[node.id] ? (node.id === "google_sheets" ? "sheets" : node.id) : providerForNode[node.id] ?? node.id;
        const livePermissionEnabled = liveExecutionEnabled && liveProvidersEnabled.includes(providerPermissionKey);
        const liveActionReady = state === "connected" && livePermissionEnabled;
        return <article className="registry-node-card" key={node.id}>
          <div className="registry-node-heading">
            <BrandMark node={node} />
            <div className="registry-node-name"><h3>{node.name}</h3><span>{node.group} · v{node.version}</span></div>
            <span className={"registry-connection-state state-" + state}>{stateLabel(state)}</span>
          </div>
          <p className="registry-node-summary">
            {node.executionStatus === "registered"
              ? `${operations.length} registered ${operations.length === 1 ? "operation" : "operations"} · ${node.auth.type === "none" ? "No account credentials" : node.auth.type === "oauth2" ? "OAuth access token" : node.auth.type === "connectionString" ? "Encrypted connection string" : "Workspace credentials"}`
              : "Provider listed · native adapter and provider security checks not yet enabled"}
          </p>
          {node.executionStatus === "registered" && <div className="registry-operation-preview">
            {operations.slice(0, 2).map((operation) => <span key={operation.kind + operation.id}>{operation.name}</span>)}
            {operations.length > 2 && <span>+{operations.length - 2} more</span>}
          </div>}
          {node.executionStatus === "registered" && connectionRequired(node) && <span className={liveActionReady ? "registry-live-permission permission-enabled" : "registry-live-permission"}>{liveActionReady ? "Live action ready" : "Live action locked"}</span>}
          {node.executionStatus === "registered" && connectionRequired(node) && <a className="registry-connect-link" href={googleProductForNode[node.id] ? `/api/integrations/google/start?product=${googleProductForNode[node.id]}` : `/dashboard/connections?provider=${encodeURIComponent(providerForNode[node.id] ?? node.id)}`}>Configure connection ↗</a>}
          {node.executionStatus === "registered" && <button className="registry-expand-button" type="button" aria-expanded={isExpanded} onClick={() => toggle(node.id)}>
            {isExpanded ? "Hide operations" : "View operations"} <span>{isExpanded ? "−" : "+"}</span>
          </button>}
          {isExpanded && <div className="registry-operation-list">
            {operations.length === 0 ? <p>No operations are registered yet.</p> : operations.map((operation) => <div className="registry-operation" key={operation.kind + operation.id}>
              <div><span>{operation.kind}</span><strong>{operation.name}</strong><code>{operation.id}</code></div><p>{operation.description}</p>
              <details className="registry-operation-schema"><summary>Input and output schema</summary>
                <div><strong>Input</strong><pre>{JSON.stringify(operation.inputSchema ?? {}, null, 2)}</pre></div>
                <div><strong>Output</strong><pre>{JSON.stringify(operation.outputSchema ?? {}, null, 2)}</pre></div>
              </details>
            </div>)}
          </div>}
        </article>;
      })}
      {filtered.length === 0 && <div className="registry-state-panel">No provider or operation matches “{query}”.</div>}
    </div>}
    <p className="registry-directory-note">
      All 100 requested providers are listed. “Coming soon” means no native execution adapter is registered yet; it is not a working connection. The AI planner can select only registered operations; live execution remains subject to provider credentials, approval, and execution gates. A connected label requires a saved workspace connection and a successful provider test.
    </p>
  </section>;
}
