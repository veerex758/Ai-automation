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
type CredentialField = { key: string; label: string; secret?: boolean };

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
  wait_delay:"◷",code_js:"</>",set_fields:"≡",json_parse:"{}",filter:"⌕",aggregate:"∑",date_time:"◷",rss_feed:"◔",
};
const providerForNode: Record<string, string> = {
  gmail: "google:gmail",
  google_sheets: "google:sheets",
  resend: "resend",
  webhook_trigger: "webhooks",
  manual_trigger: "manual",
  twilio_sms: "twilio",
  http_request: "http",
};
const connectionRequired = (node: RegistryNode) => node.auth.type !== "none";
const googleOAuthProduct: Record<string,string> = { gmail:"gmail",google_sheets:"sheets",google_drive:"drive",google_calendar:"calendar",google_docs:"docs",google_forms:"forms",youtube:"youtube",google_contacts:"contacts" };
const credentialProvider: Record<string,string> = {
  http_request:"http",twilio_sms:"twilio",twilio_voice:"twilio_voice",google_sheets:"google_sheets",gmail:"gmail",resend:"resend",
};
const credentialFields: Record<string,CredentialField[]> = {
  http:[{key:"baseUrl",label:"Base URL"},{key:"apiKey",label:"API key",secret:true},{key:"username",label:"Basic-auth username"},{key:"password",label:"Basic-auth password",secret:true}],
  openai:[{key:"apiKey",label:"API key",secret:true}],gemini:[{key:"apiKey",label:"API key",secret:true}],
  resend:[{key:"apiKey",label:"API key",secret:true},{key:"fromEmail",label:"Verified sender email"}],
  slack:[{key:"botToken",label:"Bot token",secret:true},{key:"webhookUrl",label:"Incoming webhook URL",secret:true}],
  notion:[{key:"apiKey",label:"Integration token",secret:true}],hubspot:[{key:"accessToken",label:"Private app access token",secret:true}],
  twilio:[{key:"accountSid",label:"Account SID"},{key:"authToken",label:"Auth token",secret:true},{key:"fromPhone",label:"From phone (E.164)"}],
  shopify:[{key:"shopDomain",label:"Shop domain"},{key:"accessToken",label:"Admin API access token",secret:true}],
  stripe:[{key:"secretKey",label:"Secret key",secret:true}],linear:[{key:"apiKey",label:"API key",secret:true}],
  claude:[{key:"apiKey",label:"API key",secret:true}],mistral:[{key:"apiKey",label:"API key",secret:true}],
  groq:[{key:"apiKey",label:"API key",secret:true}],perplexity:[{key:"apiKey",label:"API key",secret:true}],
  discord:[{key:"botToken",label:"Bot token",secret:true}],telegram:[{key:"botToken",label:"Bot token",secret:true}],
  whatsapp_business:[{key:"accessToken",label:"Access token",secret:true},{key:"phoneNumberId",label:"Phone number ID"}],
  sendgrid:[{key:"apiKey",label:"API key",secret:true},{key:"fromEmail",label:"Verified sender email"}],
  mailgun:[{key:"apiKey",label:"API key",secret:true},{key:"domain",label:"Sending domain"},{key:"fromEmail",label:"From email"}],
  postmark:[{key:"serverToken",label:"Server token",secret:true},{key:"fromEmail",label:"Verified sender email"}],
  github:[{key:"token",label:"Personal access token",secret:true}],gitlab:[{key:"token",label:"Access token",secret:true}],
  sentry:[{key:"authToken",label:"Auth token",secret:true}],vercel:[{key:"token",label:"Access token",secret:true}],
  calendly:[{key:"accessToken",label:"Personal access token",secret:true}],zendesk:[{key:"subdomain",label:"Subdomain"},{key:"email",label:"Account email"},{key:"apiToken",label:"API token",secret:true}],
  freshdesk:[{key:"domain",label:"Domain"},{key:"apiKey",label:"API key",secret:true}],serpapi:[{key:"apiKey",label:"API key",secret:true}],
  openweather:[{key:"apiKey",label:"API key",secret:true}],elevenlabs:[{key:"apiKey",label:"API key",secret:true}],
  stability_ai:[{key:"apiKey",label:"API key",secret:true}],hugging_face:[{key:"apiKey",label:"Access token",secret:true}],
  pinecone:[{key:"apiKey",label:"API key",secret:true},{key:"indexHost",label:"Index host"}],
  microsoft_teams:[{key:"accessToken",label:"Access token",secret:true}],salesforce:[{key:"accessToken",label:"Access token",secret:true},{key:"instanceUrl",label:"Instance URL"}],
  pipedrive:[{key:"accessToken",label:"Access token",secret:true}],zoho_crm:[{key:"accessToken",label:"Access token",secret:true}],
  freshsales:[{key:"accessToken",label:"Access token",secret:true},{key:"domain",label:"Domain"}],close:[{key:"apiKey",label:"API key",secret:true}],
  apollo:[{key:"apiKey",label:"API key",secret:true}],intercom:[{key:"accessToken",label:"Access token",secret:true}],
  jira:[{key:"siteUrl",label:"Site URL"},{key:"email",label:"Account email"},{key:"apiToken",label:"API token",secret:true}],
  asana:[{key:"accessToken",label:"Access token",secret:true}],trello:[{key:"apiKey",label:"API key",secret:true},{key:"token",label:"Token",secret:true}],
  clickup:[{key:"token",label:"Personal token",secret:true}],monday:[{key:"apiToken",label:"API token",secret:true}],
  todoist:[{key:"accessToken",label:"Access token",secret:true}],airtable:[{key:"accessToken",label:"Personal access token",secret:true}],
  bitbucket:[{key:"accessToken",label:"Access token",secret:true}],netlify:[{key:"token",label:"Access token",secret:true}],
  woocommerce:[{key:"storeUrl",label:"Store URL"},{key:"consumerKey",label:"Consumer key",secret:true},{key:"consumerSecret",label:"Consumer secret",secret:true}],
  paypal:[{key:"clientId",label:"Client ID"},{key:"clientSecret",label:"Client secret",secret:true},{key:"environment",label:"Environment (sandbox or live)"}],
  paddle:[{key:"apiKey",label:"API key",secret:true}],lemon_squeezy:[{key:"apiKey",label:"API key",secret:true},{key:"storeId",label:"Store ID"}],
  square:[{key:"accessToken",label:"Access token",secret:true},{key:"environment",label:"Environment (sandbox or production)"}],
  razorpay:[{key:"keyId",label:"Key ID"},{key:"keySecret",label:"Key secret",secret:true}],zoom:[{key:"accessToken",label:"Access token",secret:true}],
  cal_com:[{key:"apiKey",label:"API key",secret:true}],twilio_voice:[{key:"accountSid",label:"Account SID"},{key:"authToken",label:"Auth token",secret:true},{key:"fromPhone",label:"From phone (E.164)"}],
  docusign:[{key:"accessToken",label:"Access token",secret:true},{key:"accountId",label:"Account ID"},{key:"baseUri",label:"API base URI"}],
  x_twitter:[{key:"accessToken",label:"OAuth access token",secret:true}],linkedin:[{key:"accessToken",label:"OAuth access token",secret:true}],
  facebook_pages:[{key:"pageAccessToken",label:"Page access token",secret:true}],instagram:[{key:"accessToken",label:"OAuth access token",secret:true},{key:"igUserId",label:"Instagram user ID"}],
  tiktok:[{key:"accessToken",label:"OAuth access token",secret:true}],mailchimp:[{key:"apiKey",label:"API key",secret:true}],
  typeform:[{key:"accessToken",label:"OAuth access token",secret:true}],supabase:[{key:"projectUrl",label:"Project URL"},{key:"apiKey",label:"Service/API key",secret:true}],
  postgresql:[{key:"connectionString",label:"Connection string",secret:true}],redis:[{key:"restUrl",label:"REST URL"},{key:"token",label:"Access token",secret:true}],
  firebase:[{key:"projectId",label:"Project ID"},{key:"accessToken",label:"Access token",secret:true}],dropbox:[{key:"accessToken",label:"Access token",secret:true}],
  aws_s3:[{key:"accessKeyId",label:"Access key ID"},{key:"secretAccessKey",label:"Secret access key",secret:true},{key:"region",label:"AWS region"}],
  cloudflare_r2:[{key:"accountId",label:"Account ID"},{key:"accessKeyId",label:"Access key ID"},{key:"secretAccessKey",label:"Secret access key",secret:true}],
};
const credentialTestable = new Set(["resend","claude","mistral","groq","perplexity","github","sendgrid","mailgun","postmark","discord","telegram","whatsapp_business","gitlab","sentry","vercel","calendly","zendesk","freshdesk","serpapi","openweather","openai","gemini","slack","notion","hubspot","twilio","shopify","stripe","linear","elevenlabs","stability_ai","hugging_face","pinecone","microsoft_teams","salesforce","pipedrive","zoho_crm","freshsales","close","apollo","intercom","jira","asana","trello","clickup","monday","todoist","airtable","bitbucket","netlify","woocommerce","paypal","paddle","lemon_squeezy","square","razorpay","zoom","cal_com","twilio_voice","docusign","x_twitter","linkedin","facebook_pages","instagram","tiktok","mailchimp","typeform","supabase","postgresql","redis","firebase","dropbox","aws_s3","cloudflare_r2"]);


function connectionState(node: RegistryNode, workspace: ConnectionRecord[], google: ConnectionRecord[], failed: boolean): ConnectionState {
  if (node.executionStatus !== "registered") return "coming-soon";
  if (node.id === "webhook_trigger") return "setup-required";
  if (!connectionRequired(node)) return "no-connection";
  if (failed) return "unverified";
  if (googleOAuthProduct[node.id]) {
    const product = googleOAuthProduct[node.id];
    return google.some((item) => item.product === product && item.status === "connected") ? "connected" : "not-connected";
  }
  const provider = providerForNode[node.id] ?? node.id;
  const record = workspace.find((item) => item.provider === provider);
  if (!record) return "not-connected";
  return record.status === "connected" && (record.last_test_status === "success" || record.last_test_status === "passed") ? "connected" : "not-connected";
}

function BrandMark({ node }: { node: RegistryNode }) {
  const asset = officialBrandAssets[node.id];
  if (asset) {
    return <span className="integration-brand-mark official-brand-mark">
      <img src={`https://cdn.simpleicons.org/${asset.slug.trim()}`} alt={`${asset.label} logo`} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = "none"; event.currentTarget.parentElement?.setAttribute("data-logo-fallback", node.name.slice(0, 1).toUpperCase()); }} />
    </span>;
  }
  return <span className={"integration-brand-mark registry-native-mark native-" + node.id} aria-label={`${node.name} native icon`}>
    {nativeNodeGlyphs[node.id] ?? node.name.slice(0, 1).toUpperCase()}
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
  const [connecting, setConnecting] = useState<RegistryNode | null>(null);
  const [credentialValues, setCredentialValues] = useState<Record<string,string>>({});
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState("");

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
  const beginConnect = (node: RegistryNode) => {
    if (googleOAuthProduct[node.id]) { window.location.assign("/api/integrations/google/start?product=" + encodeURIComponent(googleOAuthProduct[node.id])); return; }
    const provider = credentialProvider[node.id] ?? node.id;
    setConnecting(node); setCredentialValues({}); setConnectionMessage("");
    if (node.auth.type === "oauth2") setConnectionMessage("OAuth provider: this form accepts an existing access token only. Aivanta will not claim OAuth authorization or refresh-token support unless that provider's OAuth flow is implemented.");
    if (!credentialFields[provider]) setConnectionMessage("A provider-specific connection flow is not available yet. No credential will be accepted through a generic form.");
  };
  const saveConnection = async () => {
    if (!connecting) return;
    const provider = credentialProvider[connecting.id] ?? connecting.id;
    const fields = credentialFields[provider];
    if (!fields) return;
    const credentials = Object.fromEntries(fields.filter((field) => credentialValues[field.key]?.trim()).map((field) => [field.key,credentialValues[field.key].trim()]));
    setConnectionBusy(true); setConnectionMessage("");
    try {
      const saved = await fetch("/api/integrations/workspace", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({provider,credentials}) });
      const savedBody = await saved.json().catch(() => ({}));
      if (!saved.ok) throw new Error(savedBody.error ?? "Could not save this connection.");
      if (credentialTestable.has(provider)) {
        const tested = await fetch("/api/integrations/workspace/test", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({provider})});
        const testedBody = await tested.json().catch(() => ({}));
        if (!tested.ok) throw new Error(testedBody.message ?? testedBody.error ?? "Credentials were saved but provider verification failed.");
        setConnectionMessage("Connection verified successfully.");
      } else {
        setConnectionMessage("Credentials saved securely. This provider does not yet have an implemented read-only verification test, so it is not marked connected.");
      }
      const response = await fetch("/api/integrations/workspace",{cache:"no-store"});
      const payload = await response.json().catch(() => ({}));
      setWorkspace(Array.isArray(payload.integrations)?payload.integrations:[]);
    } catch(error) {
      setConnectionMessage(error instanceof Error?error.message:"Connection setup failed.");
      const response = await fetch("/api/integrations/workspace",{cache:"no-store"}).catch(() => null);
      if (response?.ok) { const payload = await response.json().catch(() => ({})); setWorkspace(Array.isArray(payload.integrations)?payload.integrations:[]); }
    } finally { setConnectionBusy(false); }
  };

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
          {node.executionStatus === "registered" && connectionRequired(node) && (credentialFields[credentialProvider[node.id] ?? node.id] || googleOAuthProduct[node.id]) && <button className="registry-expand-button" type="button" onClick={() => beginConnect(node)}>Connect account</button>}
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
    {connecting && <div className="registry-connect-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !connectionBusy) setConnecting(null); }}>
      <section className="registry-connect-dialog" role="dialog" aria-modal="true" aria-labelledby="registry-connect-title">
        <div className="registry-connect-heading"><div><span>WORKSPACE CONNECTION</span><h2 id="registry-connect-title">Connect {connecting.name}</h2></div><button type="button" onClick={() => setConnecting(null)} disabled={connectionBusy} aria-label="Close">×</button></div>
        <p>Credentials are encrypted on the server and stored against this workspace. Secret values are never returned to this page.</p>
        {connecting.auth.type === "oauth2" && <p className="registry-connect-warning">This provider is labelled OAuth in the catalogue, but this form only stores an existing access token. It does not perform OAuth consent or token refresh. Use it only if you already have a valid token; otherwise wait for the provider-specific OAuth flow.</p>}
        {(credentialFields[credentialProvider[connecting.id] ?? connecting.id] ?? []).map((field) => <label className="registry-credential-field" key={field.key}><span>{field.label}</span><input type={field.secret ? "password" : "text"} autoComplete="off" value={credentialValues[field.key] ?? ""} onChange={(event) => setCredentialValues((current) => ({...current,[field.key]:event.target.value}))} /></label>)}
        {connectionMessage && <p className="registry-connect-message" role="status">{connectionMessage}</p>}
        <div className="registry-connect-actions"><button type="button" onClick={() => setConnecting(null)} disabled={connectionBusy}>Close</button><button type="button" onClick={() => void saveConnection()} disabled={connectionBusy || !(credentialFields[credentialProvider[connecting.id] ?? connecting.id] ?? []).some((field) => credentialValues[field.key]?.trim())}>{connectionBusy?"Saving and verifying…":"Save and verify"}</button></div>
      </section>
    </div>}
    <p className="registry-directory-note">
      All 100 requested providers are listed. “Coming soon” means no native execution adapter is registered yet; it is not a working connection. The AI planner can select only registered operations; live execution remains subject to provider credentials, approval, and execution gates. A connected label requires a saved workspace connection and a successful provider test.
    </p>
  </section>;
}
