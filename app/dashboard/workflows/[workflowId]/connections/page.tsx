"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import "../builder.css";

type Provider = "openai" | "gemini" | "resend" | "slack" | "http";
type Integration = { provider: Provider; status: string; display_name: string; metadata: Record<string, unknown>; last_tested_at: string | null; last_test_status: string | null };
const providerNames: Record<Provider, string> = { openai: "OpenAI", gemini: "Google Gemini", resend: "Resend Email", slack: "Slack Incoming Webhook", http: "Custom HTTPS API" };
const providerDescriptions: Record<Provider, string> = {
  openai: "Use OpenAI models for generation, summarization, extraction, and classification.",
  gemini: "Use Google's Gemini API with a key from Google AI Studio.",
  resend: "Send real email through Resend. Live recipients remain separately allowlisted.",
  slack: "Post messages through a Slack incoming webhook. Sending a test message is an explicit action that posts to the connected channel.",
  http: "Connect one HTTPS API host. The host must also be allowed by AIVANTA_HTTP_ALLOWED_HOSTS on the server.",
};

export default function WorkflowConnectionsPage() {
  const params = useParams<{ workflowId: string }>();
  const workflowId = params.workflowId;
  const [provider, setProvider] = useState<Provider>("gemini");
  const [apiKey, setApiKey] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [host, setHost] = useState("");
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [encryptionConfigured, setEncryptionConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyProvider, setBusyProvider] = useState<Provider | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/workflows/${workflowId}/integrations`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load integrations.");
      setIntegrations(Array.isArray(data.integrations) ? data.integrations : []);
      setEncryptionConfigured(data.encryptionConfigured === true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load integrations.");
    } finally { setLoading(false); }
  }, [workflowId]);

  useEffect(() => { void load(); }, [load]);

  async function connect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setError(""); setNotice("");
    const credentials: Record<string, string> = {};
    if (provider === "slack") credentials.webhookUrl = webhookUrl.trim();
    else {
      credentials.apiKey = apiKey.trim();
      if (provider === "resend") credentials.fromEmail = fromEmail.trim();
      if (provider === "http") credentials.host = host.trim();
    }
    try {
      const response = await fetch(`/api/workflows/${workflowId}/integrations`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, credentials }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not connect provider.");
      setApiKey(""); setFromEmail(""); setWebhookUrl(""); setHost("");
      setNotice(provider === "slack" ? "Slack webhook URL saved securely. Delivery is not verified; URL validation will not send a message." : `${providerNames[provider]} saved securely but is not active yet. Run the connection test to enable it for workflow execution.`);
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not connect provider."); }
    finally { setSaving(false); }
  }

  async function test(providerToTest: Provider) {
    const confirmSlackDelivery = providerToTest === "slack";
    if (confirmSlackDelivery && !window.confirm("Send a real test message to the connected Slack channel? This will create a message in Slack.")) return;
    setBusyProvider(providerToTest); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/workflows/${workflowId}/integrations`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerToTest, ...(confirmSlackDelivery ? { confirmSlackDelivery: true } : {}) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Connection test failed.");
      setNotice(data.note || `${providerNames[providerToTest]} connection test passed.`);
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Connection test failed."); }
    finally { setBusyProvider(null); }
  }

  async function disconnect(providerToDisconnect: Provider) {
    if (!window.confirm(`Disconnect ${providerNames[providerToDisconnect]} from this workspace?`)) return;
    setBusyProvider(providerToDisconnect); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/workflows/${workflowId}/integrations?provider=${providerToDisconnect}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not disconnect provider.");
      setNotice(`${providerNames[providerToDisconnect]} disconnected.`);
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not disconnect provider."); }
    finally { setBusyProvider(null); }
  }

  return <main className="builder-shell">
    <aside className="workflow-side-nav">
      <Link className="workflow-side-brand" href="/"><span><img src="/aivanta-mark.svg" alt="" aria-hidden="true" /></span>Aivanta</Link>
      <div className="workflow-side-label">WORKSPACE</div>
      <Link className="workflow-side-link" href={`/dashboard/workflows/${workflowId}`}>← Visual workflow</Link>
      <Link className="workflow-side-link" href={`/dashboard/workflows/${workflowId}/advanced`}>Advanced nodes</Link>
      <div className="workflow-side-bottom"><strong>Connections</strong><small>Workspace-scoped app credentials</small></div>
    </aside>
    <section className="workflow-builder-main">
      <header className="builder-topbar">
        <Link className="builder-back" href={`/dashboard/workflows/${workflowId}/advanced`}>← <span>Advanced nodes</span></Link>
        <div className="builder-breadcrumb"><strong>App connections</strong></div>
        <span className="builder-mode"><i /> Workspace</span>
      </header>
      <div className="builder-layout">
        <section className="builder-workspace">
          <div className="builder-heading">
            <div><div className="builder-eyebrow">INTEGRATIONS</div><h1>Connect your apps</h1><p>Credentials are encrypted on the server and never returned to the browser after saving.</p></div>
          </div>
          {!encryptionConfigured && <div className="builder-error-banner">Server setup required: set AIVANTA_CREDENTIALS_ENCRYPTION_KEY in the Vercel environment for this preview before connecting an app.</div>}
          {notice && <div className="builder-notice" role="status">{notice}</div>}
          {error && <div className="builder-error-banner" role="alert">{error}</div>}
          <div className="builder-panel">
            <h2>Connected services</h2>
            {loading ? <p>Loading connections…</p> : integrations.length === 0 ? <p>No apps connected to this workspace yet.</p> : <div className="integration-list">
              {integrations.map((item) => <article className="integration-card" key={item.provider}>
                <div><strong>{item.display_name}</strong><p>{item.provider === "http" ? String(item.metadata.host ?? "HTTPS host") : providerDescriptions[item.provider]}</p>
                  <small>{item.last_test_status === "passed" ? "Test passed" : item.last_test_status === "failed" ? "Test failed" : "Not tested"}{item.last_tested_at ? ` · ${new Date(item.last_tested_at).toLocaleString()}` : ""}</small>
                </div>
                <div className="integration-actions"><span className={item.status === "connected" ? "builder-mode" : "builder-draft"}>{item.status}</span>
                  <button className="builder-validate" disabled={busyProvider !== null} onClick={() => void test(item.provider)}>{busyProvider === item.provider ? "Checking…" : item.provider === "slack" ? "Send test message" : "Test connection"}</button>
                  <button className="builder-back" disabled={busyProvider !== null} onClick={() => void disconnect(item.provider)}>Disconnect</button>
                </div>
              </article>)}
            </div>}
          </div>
          <div className="builder-panel">
            <h2>Add or update a connection</h2>
            <p>Choose the provider. Existing credentials are never displayed; saving replaces that provider&apos;s current workspace connection.</p>
            <label className="integration-field">Provider
              <select value={provider} onChange={(event) => setProvider(event.target.value as Provider)}>
                {Object.entries(providerNames).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </label>
            <p>{providerDescriptions[provider]}</p>
            <form onSubmit={connect} className="integration-form">
              {provider === "slack" ? <label className="integration-field">Incoming webhook URL<input type="password" autoComplete="off" value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} required placeholder="https://hooks.slack.com/services/…" /></label> :
                <label className="integration-field">{provider === "http" ? "Bearer API key" : "API key"}<input type="password" autoComplete="new-password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} required placeholder="Paste secret; it will not be shown again" /></label>}
              {provider === "resend" && <label className="integration-field">Verified sender address<input type="text" autoComplete="off" value={fromEmail} onChange={(event) => setFromEmail(event.target.value)} required placeholder="Aivanta <hello@your-domain.com>" /></label>}
              {provider === "http" && <label className="integration-field">API hostname (no scheme or path)<input type="text" autoComplete="off" value={host} onChange={(event) => setHost(event.target.value)} required placeholder="api.example.com" /></label>}
              <button className="builder-save" type="submit" disabled={saving || !encryptionConfigured}>{saving ? "Encrypting and saving…" : "Save connection"}</button>
            </form>
          </div>
          <div className="builder-panel"><h2>Important before live runs</h2><ul>
            <li>Live execution remains disabled unless the server explicitly enables it.</li>
            <li>Resend sends only to the server-configured live recipient allowlist.</li>
            <li>Slack verification sends a real test message only after you choose “Send test message” and confirm the action.</li>
            <li>Custom HTTP hosts must also be included in the server-side HTTPS host allowlist.</li>
            <li>Provider connection checks are read-only except the explicitly confirmed Slack test message; safe previews never trigger external side effects.</li>
          </ul></div>
        </section>
      </div>
    </section>
  </main>;
}
