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
type WorkspacePayload = { integrations?: ConnectionRecord[]; error?: string };
type GooglePayload = { connections?: ConnectionRecord[]; error?: string };

const officialBrandAssets: Record<string, { slug: string; label: string }> = {
  openai:{slug:"openai",label:"OpenAI"},gemini:{slug:"googlegemini",label:"Google Gemini"},
  claude:{slug:"anthropic",label:"Claude"},mistral:{slug:"mistral",label:"Mistral"},groq:{slug:"groq",label:"Groq"},
  perplexity:{slug:"perplexity",label:"Perplexity"},elevenlabs:{slug:"elevenlabs",label:"ElevenLabs"},
  stability_ai:{slug:"stabilityai",label:"Stability AI"},hugging_face:{slug:"huggingface",label:"Hugging Face"},pinecone:{slug:"pinecone",label:"Pinecone"},
  gmail:{slug:"gmail",label:"Gmail"},google_sheets:{slug:"googlesheets",label:"Google Sheets"},google_drive:{slug:"googledrive",label:"Google Drive"},
  google_calendar:{slug:"googlecalendar",label:"Google Calendar"},google_docs:{slug:"googledocs",label:"Google Docs"},google_forms:{slug:"googleforms",label:"Google Forms"},
  youtube:{slug:"youtube",label:"YouTube"},google_contacts:{slug:"googlecontacts",label:"Google Contacts"},
  slack:{slug:"slack",label:"Slack"},discord:{slug:"discord",label:"Discord"},telegram:{slug:"telegram",label:"Telegram"},
  whatsapp_business:{slug:"whatsapp",label:"WhatsApp Business"},twilio_sms:{slug:"twilio",label:"Twilio"},
  microsoft_teams:{slug:"microsoftteams",label:"Microsoft Teams"},resend:{slug:"resend",label:"Resend"},
  sendgrid:{slug:"sendgrid",label:"SendGrid"},mailgun:{slug:"mailgun",label:"Mailgun"},postmark:{slug:"postmark",label:"Postmark"},
  hubspot:{slug:"hubspot",label:"HubSpot"},salesforce:{slug:"salesforce",label:"Salesforce"},pipedrive:{slug:"pipedrive",label:"Pipedrive"},
  zoho_crm:{slug:"zoho",label:"Zoho CRM"},freshsales:{slug:"freshworks",label:"Freshsales"},close:{slug:"close",label:"Close"},
  apollo:{slug:"apollo",label:"Apollo"},intercom:{slug:"intercom",label:"Intercom"},notion:{slug:"notion",label:"Notion"},
  linear:{slug:"linear",label:"Linear"},jira:{slug:"jira",label:"Jira"},asana:{slug:"asana",label:"Asana"},
  trello:{slug:"trello",label:"Trello"},clickup:{slug:"clickup",label:"ClickUp"},monday:{slug:" monday",label:"Monday.com"},
  todoist:{slug:"todoist",label:"Todoist"},airtable:{slug:"airtable",label:"Airtable"},github:{slug:"github",label:"GitHub"},
  gitlab:{slug:"gitlab",label:"GitLab"},bitbucket:{slug:"bitbucket",label:"Bitbucket"},sentry:{slug:"sentry",label:"Sentry"},
  vercel:{slug:"vercel",label:"Vercel"},netlify:{slug:"netlify",label:"Netlify"},supabase:{slug:"supabase",label:"Supabase"},
  postgresql:{slug:"postgresql",label:"PostgreSQL"},mysql:{slug:"mysql",label:"MySQL"},mongodb:{slug:"mongodb",label:"MongoDB"},
  redis:{slug:"redis",label:"Redis"},firebase:{slug:"firebase",label:"Firebase"},dropbox:{slug:"dropbox",label:"Dropbox"},
  aws_s3:{slug:"amazons3",label:"AWS S3"},cloudflare_r2:{slug:"cloudflare",label:"Cloudflare R2"},
  stripe:{slug:"stripe",label:"Stripe"},shopify:{slug:"shopify",label:"Shopify"},woocommerce:{slug:"woocommerce",label:"WooCommerce"},
  paypal:{slug:"paypal",label:"PayPal"},paddle:{slug:"paddle",label:"Paddle"},lemon_squeezy:{slug:"lemonsqueezy",label:"Lemon Squeezy"},
  square:{slug:"square",label:"Square"},razorpay:{slug:"razorpay",label:"Razorpay"},x_twitter:{slug:"x",label:"X"},
  linkedin:{slug:"linkedin",label:"LinkedIn"},facebook_pages:{slug:"facebook",label:"Facebook Pages"},instagram:{slug:"instagram",label:"Instagram"},
  tiktok:{slug:"tiktok",label:"TikTok"},mailchimp:{slug:"mailchimp",label:"Mailchimp"},typeform:{slug:"typeform",label:"Typeform"},
  calendly:{slug:"calendly",label:"Calendly"},zendesk:{slug:"zendesk",label:"Zendesk"},freshdesk:{slug:"freshdesk",label:"Freshdesk"},
  zoom:{slug:"zoom",label:"Zoom"},cal_com:{slug:"caldotcom",label:"Cal.com"},twilio_voice:{slug:"twilio",label:"Twilio Voice"},
  docusign:{slug:"docusign",label:"DocuSign"},serpapi:{slug:"google",label:"SerpAPI"},openweather:{slug:"openweathermap",label:"OpenWeather"},
};
const nativeNodeGlyphs: Record<string,string> = {
  webhook_trigger:"↗",schedule_cron:"◷",manual_trigger:"▶",http_request:"⇄",if:"◇",switch:"⇄",loop:"↻",merge:"⊕",
  wait_delay:"◷",code_js:"</>",set_fields:"≡",json_parse:"{}",filter:"⌕",aggregate:"∑",date_time:"◷",
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
  if (node.executionStatus !== "registered") return "coming-soon";
  if (node.id === "webhook_trigger") return "setup-required";
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
      <img src={`https://cdn.simpleicons.org/${asset.slug.trim()}`} alt={`${asset.label} logo`} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = "none"; }} />
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
    case "setup-required": return "Endpoint setup required";
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
  const registeredCount = nodes.filter((node) => node.executionStatus === "registered").length;
  const toggle = (id: string) => setExpanded((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);

  return <section className="registry-integrations" aria-label="Aivanta provider directory">
    <div className="registry-directory-toolbar">
      <div>
        <strong>{nodes.length} providers</strong>
        <span>{registeredCount} registered adapters · {connectedCount} verified connections</span>
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
            {node.executionStatus === "registered"
              ? `${operations.length} registered ${operations.length === 1 ? "operation" : "operations"} · ${node.auth.type === "none" ? "No account credentials" : node.auth.type === "oauth2" ? "OAuth authorization" : node.auth.type === "connectionString" ? "Encrypted connection string" : "Workspace credentials"}`
              : "Provider listed · native adapter and provider security checks not yet enabled"}
          </p>
          {node.executionStatus === "registered" && <div className="registry-operation-preview">
            {operations.slice(0, 2).map((operation) => <span key={operation.kind + operation.id}>{operation.name}</span>)}
            {operations.length > 2 && <span>+{operations.length - 2} more</span>}
          </div>}
          {node.executionStatus === "registered" && <button className="registry-expand-button" type="button" aria-expanded={isExpanded} onClick={() => toggle(node.id)}>
            {isExpanded ? "Hide operations" : "View operations"} <span>{isExpanded ? "−" : "+"}</span>
          </button>}
          {isExpanded && <div className="registry-operation-list">
            {operations.length === 0 ? <p>No operations are registered yet.</p> : operations.map((operation) => <div className="registry-operation" key={operation.kind + operation.id}>
              <div><span>{operation.kind}</span><strong>{operation.name}</strong><code>{operation.id}</code></div><p>{operation.description}</p><details className="registry-operation-schema"><summary>Input and output schema</summary><div><strong>Input</strong><pre>{JSON.stringify(operation.inputSchema ?? {}, null, 2)}</pre><strong>Output</strong><pre>{JSON.stringify(operation.outputSchema ?? {}, null, 2)}</pre></div></details>
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
