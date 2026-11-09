"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import "./connections.css";

type Connection = {
  id: string;
  product: "gmail" | "sheets" | "drive" | "calendar" | "docs" | "forms" | "youtube" | "contacts";
  account_email: string;
  scopes: string[];
  status: "connected" | "needs_reauth" | "revoked";
  expires_at: string | null;
};

const statusMessages: Record<string, string> = {
  connected: "Google account authorized. Credentials are stored encrypted on the server.",
  cancelled: "Authorization was cancelled. No connection was added.",
  invalid_state: "The authorization response could not be verified. Start again for your security.",
  sign_in_required: "Your session expired. Sign in and try again.",
  token_exchange_failed: "Google could not complete authorization. Please try again.",
  profile_failed: "A verified Google account profile could not be confirmed.",
  server_not_configured: "Connection storage is not configured for this environment.",
  save_failed: "Authorization succeeded, but Aivanta could not save the connection.",
  connection_failed: "The connection could not be completed. No credentials were shown.",
  not_configured: "Google OAuth is not configured for this environment yet.",
};


type WorkspaceProvider = "openai" | "gemini" | "resend" | "slack" | "http" | "notion" | "hubspot" | "twilio" | "shopify" | "stripe" | "linear" | "claude" | "mistral" | "groq" | "perplexity" | "discord" | "telegram" | "whatsapp_business" | "sendgrid" | "mailgun" | "postmark" | "github" | "gitlab" | "sentry" | "vercel" | "calendly" | "zendesk" | "freshdesk" | "serpapi" | "openweather" | "elevenlabs" | "stability_ai" | "hugging_face" | "pinecone" | "microsoft_teams" | "salesforce" | "pipedrive" | "zoho_crm" | "freshsales" | "close" | "apollo" | "intercom" | "jira" | "asana" | "trello" | "clickup" | "monday" | "todoist" | "airtable" | "bitbucket" | "netlify" | "woocommerce" | "paypal" | "paddle" | "lemon_squeezy" | "square" | "razorpay" | "zoom" | "cal_com" | "twilio_voice" | "docusign" | "x_twitter" | "linkedin" | "facebook_pages" | "instagram" | "tiktok" | "mailchimp" | "typeform" | "supabase" | "postgresql" | "mysql" | "mongodb" | "redis" | "firebase" | "dropbox" | "aws_s3" | "cloudflare_r2";
type WorkspaceIntegration = {
  id: string;
  provider: WorkspaceProvider;
  display_name: string;
  status: string;
  updated_at: string;
};

const providerFields: Record<WorkspaceProvider, { label: string; fields: Array<{ name: string; label: string; type: string; required?: boolean }> }> = {
  openai: { label: "OpenAI", fields: [{ name: "apiKey", label: "API key", type: "password" }] },
  gemini: { label: "Google Gemini", fields: [{ name: "apiKey", label: "API key", type: "password" }] },
  resend: { label: "Resend email", fields: [
    { name: "apiKey", label: "API key", type: "password" },
    { name: "fromEmail", label: "Verified sender email", type: "email" },
  ] },
  slack: { label: "Slack", fields: [
    { name: "botToken", label: "Bot token (chat:write)", type: "password", required: false },
    { name: "webhookUrl", label: "Incoming webhook URL (optional alternative)", type: "password", required: false },
  ] },
  notion: { label: "Notion", fields: [{ name: "apiKey", label: "Internal integration token", type: "password" }] },
  hubspot: { label: "HubSpot", fields: [{ name: "accessToken", label: "Private app access token", type: "password" }] },
  twilio: { label: "Twilio", fields: [
    { name: "accountSid", label: "Account SID", type: "text" },
    { name: "authToken", label: "Auth token", type: "password" },
    { name: "fromPhone", label: "Twilio sender number (E.164)", type: "tel" },
  ] },
  shopify: { label: "Shopify", fields: [
    { name: "shopDomain", label: "Shop domain (store.myshopify.com)", type: "text" },
    { name: "accessToken", label: "Admin API access token", type: "password" },
  ] },
  stripe: { label: "Stripe", fields: [{ name: "secretKey", label: "Secret or restricted API key", type: "password" }] },
  linear: { label: "Linear", fields: [{ name: "apiKey", label: "API key", type: "password" }] },
  elevenlabs: { label: "ElevenLabs", fields: [{ name: "apiKey", label: "API key", type: "password" }] },
  stability_ai: { label: "Stability AI", fields: [{ name: "apiKey", label: "API key", type: "password" }] },
  hugging_face: { label: "Hugging Face", fields: [{ name: "apiKey", label: "Access token", type: "password" }] },
  pinecone: { label: "Pinecone", fields: [{ name: "apiKey", label: "API key", type: "password" }, { name: "indexHost", label: "Index host (HTTPS Pinecone host)", type: "url" }] },
  microsoft_teams: { label: "Microsoft Teams", fields: [{ name: "accessToken", label: "Microsoft Graph access token", type: "password" }] },
  salesforce: { label: "Salesforce", fields: [{ name: "accessToken", label: "OAuth access token", type: "password" }, { name: "instanceUrl", label: "Salesforce instance URL", type: "url" }] },
  pipedrive: { label: "Pipedrive", fields: [{ name: "accessToken", label: "OAuth access token", type: "password" }] },
  zoho_crm: { label: "Zoho CRM", fields: [{ name: "accessToken", label: "OAuth access token", type: "password" }] },
  freshsales: { label: "Freshsales", fields: [{ name: "accessToken", label: "OAuth access token", type: "password" }, { name: "domain", label: "Freshworks domain (yourname.myfreshworks.com)", type: "text" }] },
  close: { label: "Close", fields: [{ name: "apiKey", label: "API key", type: "password" }] },
  apollo: { label: "Apollo", fields: [{ name: "apiKey", label: "API key", type: "password" }] },
  intercom: { label: "Intercom", fields: [{ name: "accessToken", label: "OAuth access token", type: "password" }] },
  jira: { label: "Jira", fields: [{ name: "siteUrl", label: "Atlassian site URL", type: "url" }, { name: "email", label: "Account email", type: "email" }, { name: "apiToken", label: "API token", type: "password" }] },
  asana: { label: "Asana", fields: [{ name: "accessToken", label: "OAuth access token", type: "password" }] },
  trello: { label: "Trello", fields: [{ name: "apiKey", label: "API key", type: "password" }, { name: "token", label: "API token", type: "password" }] },
  clickup: { label: "ClickUp", fields: [{ name: "token", label: "Personal API token", type: "password" }] },
  monday: { label: "Monday.com", fields: [{ name: "apiToken", label: "API token", type: "password" }] },
  todoist: { label: "Todoist", fields: [{ name: "accessToken", label: "OAuth access token", type: "password" }] },
  airtable: { label: "Airtable", fields: [{ name: "accessToken", label: "Personal access token", type: "password" }] },
  bitbucket: { label: "Bitbucket", fields: [{ name: "accessToken", label: "OAuth access token", type: "password" }] },
  netlify: { label: "Netlify", fields: [{ name: "token", label: "Personal access token", type: "password" }] },
  woocommerce: { label: "WooCommerce", fields: [{ name: "storeUrl", label: "HTTPS store URL", type: "url" }, { name: "consumerKey", label: "Consumer key", type: "password" }, { name: "consumerSecret", label: "Consumer secret", type: "password" }] },
  paypal: { label: "PayPal", fields: [{ name: "clientId", label: "REST client ID", type: "password" }, { name: "clientSecret", label: "REST client secret", type: "password" }, { name: "environment", label: "Environment (sandbox or live)", type: "text" }] },
  paddle: { label: "Paddle", fields: [{ name: "apiKey", label: "API key", type: "password" }] },
  lemon_squeezy: { label: "Lemon Squeezy", fields: [{ name: "apiKey", label: "API key", type: "password" }, { name: "storeId", label: "Store ID", type: "text" }] },
  square: { label: "Square", fields: [{ name: "accessToken", label: "Access token", type: "password" }, { name: "environment", label: "Environment (sandbox or production)", type: "text" }] },
  razorpay: { label: "Razorpay", fields: [{ name: "keyId", label: "Key ID", type: "text" }, { name: "keySecret", label: "Key secret", type: "password" }] },
  zoom: { label: "Zoom", fields: [{ name: "accessToken", label: "OAuth access token", type: "password" }] },
  cal_com: { label: "Cal.com", fields: [{ name: "apiKey", label: "API key", type: "password" }] },
  twilio_voice: { label: "Twilio Voice", fields: [{ name: "accountSid", label: "Account SID", type: "text" }, { name: "authToken", label: "Auth token", type: "password" }, { name: "fromPhone", label: "Twilio voice caller ID (E.164)", type: "tel" }] },
  docusign: { label: "DocuSign", fields: [{ name: "accessToken", label: "OAuth access token", type: "password" }, { name: "accountId", label: "Account ID", type: "text" }, { name: "baseUri", label: "API base URI", type: "url" }] },
  x_twitter: { label: "X/Twitter", fields: [{ name: "accessToken", label: "OAuth access token", type: "password" }] },
  linkedin: { label: "LinkedIn", fields: [{ name: "accessToken", label: "OAuth access token", type: "password" }] },
  facebook_pages: { label: "Facebook Pages", fields: [{ name: "pageAccessToken", label: "Page access token", type: "password" }] },
  instagram: { label: "Instagram", fields: [{ name: "accessToken", label: "Graph API access token", type: "password" }, { name: "igUserId", label: "Instagram professional account ID", type: "text" }] },
  tiktok: { label: "TikTok", fields: [{ name: "accessToken", label: "OAuth access token", type: "password" }] },
  mailchimp: { label: "Mailchimp", fields: [{ name: "apiKey", label: "API key (includes server region suffix)", type: "password" }] },
  typeform: { label: "Typeform", fields: [{ name: "accessToken", label: "Personal access token", type: "password" }] },
  supabase: { label: "Supabase", fields: [{ name: "projectUrl", label: "Project URL (https://project.supabase.co)", type: "url" }, { name: "apiKey", label: "API key (scoped key preferred)", type: "password" }] },
  mysql: { label: "MySQL", fields: [{ name: "connectionString", label: "MySQL connection string", type: "password" }] },
  mongodb: { label: "MongoDB", fields: [{ name: "connectionString", label: "MongoDB connection string", type: "password" }] },
  postgresql: { label: "PostgreSQL", fields: [{ name: "connectionString", label: "Connection string (TLS required)", type: "password" }] },
  redis: { label: "Redis (Upstash REST)", fields: [{ name: "restUrl", label: "Upstash REST URL", type: "url" }, { name: "token", label: "REST token", type: "password" }] },
  firebase: { label: "Firebase / Firestore", fields: [{ name: "projectId", label: "Firebase project ID", type: "text" }, { name: "accessToken", label: "Google access token with datastore scope", type: "password" }] },
  dropbox: { label: "Dropbox", fields: [{ name: "accessToken", label: "OAuth access token", type: "password" }] },
  aws_s3: { label: "AWS S3", fields: [{ name: "accessKeyId", label: "Access key ID", type: "text" }, { name: "secretAccessKey", label: "Secret access key", type: "password" }, { name: "region", label: "AWS region", type: "text" }] },
  cloudflare_r2: { label: "Cloudflare R2", fields: [{ name: "accountId", label: "Cloudflare account ID", type: "text" }, { name: "accessKeyId", label: "R2 access key ID", type: "text" }, { name: "secretAccessKey", label: "R2 secret access key", type: "password" }] },
  http: { label: "HTTP API", fields: [{ name: "baseUrl", label: "Base URL (HTTPS)", type: "url" }, { name: "apiKey", label: "API key", type: "password", required: false }, { name: "username", label: "Basic auth username", type: "text", required: false }, { name: "password", label: "Basic auth password", type: "password", required: false }] },
  claude: { label: "Claude", fields: [{ name: "apiKey", label: "API key", type: "password" }] },
  mistral: { label: "Mistral", fields: [{ name: "apiKey", label: "API key", type: "password" }] },
  groq: { label: "Groq", fields: [{ name: "apiKey", label: "API key", type: "password" }] },
  perplexity: { label: "Perplexity", fields: [{ name: "apiKey", label: "API key", type: "password" }] },
  discord: { label: "Discord", fields: [{ name: "botToken", label: "Bot token", type: "password" }] },
  telegram: { label: "Telegram", fields: [{ name: "botToken", label: "Bot token", type: "password" }] },
  whatsapp_business: { label: "WhatsApp Business", fields: [{ name: "accessToken", label: "System user access token", type: "password" }, { name: "phoneNumberId", label: "Phone number ID", type: "text" }] },
  sendgrid: { label: "SendGrid", fields: [{ name: "apiKey", label: "API key", type: "password" }, { name: "fromEmail", label: "Verified sender email", type: "email" }] },
  mailgun: { label: "Mailgun", fields: [{ name: "apiKey", label: "API key", type: "password" }, { name: "domain", label: "Sending domain", type: "text" }, { name: "fromEmail", label: "Verified sender email", type: "email" }] },
  postmark: { label: "Postmark", fields: [{ name: "serverToken", label: "Server token", type: "password" }, { name: "fromEmail", label: "Verified sender email", type: "email" }] },
  github: { label: "GitHub", fields: [{ name: "token", label: "Personal access token", type: "password" }] },
  gitlab: { label: "GitLab", fields: [{ name: "token", label: "Personal access token", type: "password" }] },
  sentry: { label: "Sentry", fields: [{ name: "authToken", label: "Auth token", type: "password" }] },
  vercel: { label: "Vercel", fields: [{ name: "token", label: "Access token", type: "password" }] },
  calendly: { label: "Calendly", fields: [{ name: "accessToken", label: "OAuth access token", type: "password" }] },
  zendesk: { label: "Zendesk", fields: [{ name: "subdomain", label: "Zendesk subdomain", type: "text" }, { name: "email", label: "Account email", type: "email" }, { name: "apiToken", label: "API token", type: "password" }] },
  freshdesk: { label: "Freshdesk", fields: [{ name: "domain", label: "Freshdesk domain", type: "text" }, { name: "apiKey", label: "API key", type: "password" }] },
  serpapi: { label: "SerpAPI", fields: [{ name: "apiKey", label: "API key", type: "password" }] },
  openweather: { label: "OpenWeather", fields: [{ name: "apiKey", label: "API key", type: "password" }] },
};

function WorkspaceIntegrationManager() {
  const [integrations, setIntegrations] = useState<WorkspaceIntegration[]>([]);
  const [provider, setProvider] = useState<WorkspaceProvider>("gemini");
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingResend, setTestingResend] = useState(false);
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [sendingResendTest, setSendingResendTest] = useState(false);
  const [notice, setNotice] = useState("");
  const [workflowId, setWorkflowId] = useState("");
  const [workflowId, setWorkflowId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("provider");
    if (requested && Object.prototype.hasOwnProperty.call(providerFields, requested)) {
      setProvider(requested as WorkspaceProvider);
      setValues({});
    }
  }, []);

  useEffect(() => {
    fetch("/api/integrations/workspace", { cache: "no-store" })
      .then(async response => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Could not load workspace integrations.");
        setIntegrations(payload.integrations ?? []);
      })
      .catch(reason => setError(reason instanceof Error ? reason.message : "Could not load workspace integrations."))
      .finally(() => setLoading(false));
  }, []);

  async function testResend() {
    setTestingResend(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/integrations/workspace/resend/test", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not test the Resend connection.");
      setIntegrations(current => current.map(item => item.provider === "resend" ? { ...item, status: payload.senderDomainVerified ? "connected" : "needs_attention" } : item));
      setNotice(payload.message ?? "Resend connection checked. No email was sent.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not test the Resend connection.");
    } finally {
      setTestingResend(false);
    }
  }

  async function testProvider(provider: WorkspaceProvider) {
    setTestingProvider(provider);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/integrations/workspace/test", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message ?? payload.error ?? "Connection check failed.");
      setIntegrations(current => current.map(item => item.provider === provider ? { ...item, status: "connected" } : item));
      setNotice(payload.message ?? "Credential authenticated. No workflow was executed.");
    } catch (reason) {
      setIntegrations(current => current.map(item => item.provider === provider ? { ...item, status: "needs_attention" } : item));
      setError(reason instanceof Error ? reason.message : "Could not test this connection.");
    } finally { setTestingProvider(null); }
  }

  async function sendResendTestEmail() {
    setSendingResendTest(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/integrations/workspace/resend/test-email", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not send the Resend test email.");
      setNotice(payload.message ?? `Resend accepted a test email for ${payload.recipient}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not send the Resend test email.");
    } finally {
      setSendingResendTest(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/integrations/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, displayName: providerFields[provider].label, credentials: Object.fromEntries(Object.entries(values).filter(([, value]) => value.trim())) }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not save this integration.");
      const saved = payload.integration as WorkspaceIntegration;
      setIntegrations(current => [saved, ...current.filter(item => item.provider !== provider)]);
      setValues({});
      setNotice("Connection saved securely. The secret is encrypted and will not be shown again.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save this integration.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="workspace-integration-manager">
      <div className="connections-list-heading">
        <div><h2>Workflow connections</h2><p>Save provider credentials to this workspace. They are encrypted at rest and only decrypted by the server during an authorized run.</p></div>
        <span>{integrations.length} saved</span>
      </div>
      <p className="connections-footnote">Google connections use Aivanta-managed OAuth. For other OAuth-based providers, this manager currently accepts a manually issued access token; provider-specific consent screens and automatic token refresh are not yet available. A token must pass its read-only connection test before live execution is permitted.</p>
      {notice && <p className="connections-notice" role="status">{notice}</p>}
      {error && <p className="connections-error" role="alert">{error}</p>}
      <div className="workspace-integration-layout">
        <div className="workspace-integration-saved">
          <h3>Saved connections</h3>
          {loading ? <p className="connections-empty">Loading connections…</p> : integrations.length === 0
            ? <p className="connections-empty">No workflow provider credentials saved yet.</p>
            : integrations.map(item => (
              <div className="workspace-integration-saved-row" key={item.id}>
                <div><strong>{item.display_name}</strong><span>{item.provider} · updated {new Date(item.updated_at).toLocaleDateString()}</span></div>
                <div className="workspace-integration-row-actions"><span className={item.status === "connected" ? "connection-status" : "status-needs_reauth"}>{item.status.replace("_", " ")}</span>{item.provider !== "resend" && <button type="button" onClick={() => testProvider(item.provider)} disabled={testingProvider !== null}>{testingProvider === item.provider ? "Testing…" : "Test connection"}</button>}{item.provider === "resend" && <><button type="button" onClick={testResend} disabled={testingResend || sendingResendTest}>{testingResend ? "Testing…" : "Test connection"}</button><button type="button" onClick={sendResendTestEmail} disabled={testingResend || sendingResendTest}>{sendingResendTest ? "Sending test…" : "Send test email"}</button></>}</div>
              </div>
            ))}
        </div>
        <form className="workspace-integration-form" onSubmit={save}>
          <h3>Add or update a connection</h3>
          <label htmlFor="workspace-provider">Provider</label>
          <select id="workspace-provider" value={provider} onChange={event => { setProvider(event.target.value as WorkspaceProvider); setValues({}); }}>
            {Object.entries(providerFields).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
          </select>
          {providerFields[provider].fields.map(field => (
            <label className="workspace-secret-field" key={field.name}>
              {field.label}
              <input
                type={field.type}
                autoComplete="off"
                required={field.required !== false}
                value={values[field.name] ?? ""}
                onChange={event => setValues(current => ({ ...current, [field.name]: event.target.value }))}
              />
            </label>
          ))}
          <button type="submit" disabled={saving}>{saving ? "Saving securely…" : "Save connection"}</button>
          <p>Existing credentials are replaced when you save again. Aivanta never returns saved secrets to the browser.</p>
        </form>
      </div>
    </section>
  );
}

export default function ConnectionsPage() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedWorkflow = params.get("workflowId");
    let rememberedWorkflow = "";
    try { rememberedWorkflow = window.sessionStorage.getItem("aivanta-return-workflow") || ""; } catch { /* Continue without remembered target. */ }
    const nextWorkflow = requestedWorkflow && /^[0-9a-f-]{36}$/i.test(requestedWorkflow) ? requestedWorkflow : rememberedWorkflow;
    if (nextWorkflow) { setWorkflowId(nextWorkflow); try { window.sessionStorage.setItem("aivanta-return-workflow", nextWorkflow); } catch { /* State remains available on this page. */ } }
    const status = params.get("google");
    if (status) setNotice(statusMessages[status] ?? "Google authorization returned.");
    fetch("/api/integrations/google/connections", { cache: "no-store" })
      .then(async response => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Could not load connections.");
        setConnections(payload.connections ?? []);
      })
      .catch(reason => setError(reason instanceof Error ? reason.message : "Could not load connections."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="connections-page">
      <div className="connections-top"><Link href="/dashboard">← Dashboard</Link><span>AIVANTA / CONNECTIONS</span></div>
      <section className="connections-hero">
        <div className="connections-eyebrow">YOUR WORKSPACE, CONNECTED</div>
        <h1>Connect your tools.</h1>
        {workflowId && <Link className="connections-return" href={`/dashboard/workflows/${workflowId}`}>Return to your workflow <span aria-hidden="true">→</span></Link>}
        <p>Authorize services using their official sign-in screens. Aivanta never asks for your provider password.</p>
      </section>

      {notice && <p className="connections-notice" role="status">{notice}</p>}
      {error && <p className="connections-error" role="alert">{error}</p>}

      <section className="connections-grid" aria-label="Available integrations">
        <article className="connection-card">
          <div className="connection-icon google-icon" aria-hidden="true">G</div>
          <div className="connection-card-copy"><h2>Gmail</h2><p>Authorize access to read messages. Sending email is not enabled by this permission.</p></div>
          <span className="connection-scope">READ ONLY</span>
          <a className="connection-button" href="/api/integrations/google/start?product=gmail">Connect Gmail <span aria-hidden="true">↗</span></a>
        </article>
        <article className="connection-card">
          <div className="connection-icon sheets-icon" aria-hidden="true">▦</div>
          <div className="connection-card-copy"><h2>Google Sheets</h2><p>Authorize read-only access to spreadsheets. Editing cells requires a separate permission rollout.</p></div>
          <span className="connection-scope">READ ONLY</span>
          <a className="connection-button" href="/api/integrations/google/start?product=sheets">Connect Sheets <span aria-hidden="true">↗</span></a>
        </article>
        <article className="connection-card"><div className="connection-icon google-icon" aria-hidden="true">G</div><div className="connection-card-copy"><h2>Google Drive</h2><p>Read file metadata and search Drive. No file edits or deletes.</p></div><span className="connection-scope">READ ONLY</span><a className="connection-button" href="/api/integrations/google/start?product=drive">Connect Drive <span aria-hidden="true">↗</span></a></article>
        <article className="connection-card"><div className="connection-icon google-icon" aria-hidden="true">G</div><div className="connection-card-copy"><h2>Google Calendar</h2><p>Read calendar events in a selected time window. No event changes.</p></div><span className="connection-scope">READ ONLY</span><a className="connection-button" href="/api/integrations/google/start?product=calendar">Connect Calendar <span aria-hidden="true">↗</span></a></article>
        <article className="connection-card"><div className="connection-icon google-icon" aria-hidden="true">G</div><div className="connection-card-copy"><h2>Google Docs</h2><p>Read document metadata and content structure. No document edits.</p></div><span className="connection-scope">READ ONLY</span><a className="connection-button" href="/api/integrations/google/start?product=docs">Connect Docs <span aria-hidden="true">↗</span></a></article>
        <article className="connection-card"><div className="connection-icon google-icon" aria-hidden="true">G</div><div className="connection-card-copy"><h2>Google Forms</h2><p>Read form titles and question metadata. No response or form edits.</p></div><span className="connection-scope">READ ONLY</span><a className="connection-button" href="/api/integrations/google/start?product=forms">Connect Forms <span aria-hidden="true">↗</span></a></article>
        <article className="connection-card"><div className="connection-icon google-icon" aria-hidden="true">▶</div><div className="connection-card-copy"><h2>YouTube</h2><p>Search videos and read channel metadata. No publishing actions.</p></div><span className="connection-scope">READ ONLY</span><a className="connection-button" href="/api/integrations/google/start?product=youtube">Connect YouTube <span aria-hidden="true">↗</span></a></article>
        <article className="connection-card"><div className="connection-icon google-icon" aria-hidden="true">G</div><div className="connection-card-copy"><h2>Google Contacts</h2><p>Read contact names, email addresses and phone numbers.</p></div><span className="connection-scope">READ ONLY</span><a className="connection-button" href="/api/integrations/google/start?product=contacts">Connect Contacts <span aria-hidden="true">↗</span></a></article>
      </section>

      <WorkspaceIntegrationManager />

      <section className="connections-list">
        <div className="connections-list-heading"><div><h2>Connected accounts</h2><p>Only account details and permission names are shown here. Tokens never reach the browser.</p></div><span>{connections.length} {connections.length === 1 ? "connection" : "connections"}</span></div>
        {loading ? <p className="connections-empty">Loading connections…</p> : connections.length === 0 ? <p className="connections-empty">No Google accounts connected yet.</p> : connections.map(connection => (
          <article className="connection-row" key={connection.id}>
            <div className={`connection-icon ${connection.product === "gmail" ? "google-icon" : "sheets-icon"}`} aria-hidden="true">{connection.product === "gmail" ? "G" : "▦"}</div>
            <div className="connection-row-copy"><strong>{connection.account_email}</strong><span>{({ gmail: "Gmail", sheets: "Google Sheets", drive: "Google Drive", calendar: "Google Calendar", docs: "Google Docs", forms: "Google Forms", youtube: "YouTube", contacts: "Google Contacts" } as Record<string, string>)[connection.product]} · {connection.scopes.length} permissions</span></div>
            <span className={`connection-status status-${connection.status}`}>{connection.status.replace("_", " ")}</span>
          </article>
        ))}
      </section>
      <p className="connections-footnote">Authorization is separate from workflow execution. A connected account will not trigger a workflow by itself.</p>
    </main>
  );
}
