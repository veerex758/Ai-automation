"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import "./connections.css";

type Connection = {
  id: string;
  product: "gmail" | "sheets";
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


type WorkspaceProvider = "openai" | "gemini" | "resend" | "slack";
type WorkspaceIntegration = {
  id: string;
  provider: WorkspaceProvider;
  display_name: string;
  status: string;
  updated_at: string;
};

const providerFields: Record<WorkspaceProvider, { label: string; fields: Array<{ name: string; label: string; type: string }> }> = {
  openai: { label: "OpenAI", fields: [{ name: "apiKey", label: "API key", type: "password" }] },
  gemini: { label: "Google Gemini", fields: [{ name: "apiKey", label: "API key", type: "password" }] },
  resend: { label: "Resend email", fields: [
    { name: "apiKey", label: "API key", type: "password" },
    { name: "fromEmail", label: "Verified sender email", type: "email" },
  ] },
  slack: { label: "Slack", fields: [{ name: "webhookUrl", label: "Incoming webhook URL", type: "password" }] },
};

function WorkspaceIntegrationManager() {
  const [integrations, setIntegrations] = useState<WorkspaceIntegration[]>([]);
  const [provider, setProvider] = useState<WorkspaceProvider>("gemini");
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);\n  const [testingResend, setTestingResend] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

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

  async function testResend() {\n    setTestingResend(true);\n    setError("");\n    setNotice("");\n    try {\n      const response = await fetch("/api/integrations/workspace/resend/test", { method: "POST" });\n      const payload = await response.json();\n      if (!response.ok) throw new Error(payload.error ?? "Could not test the Resend connection.");\n      setIntegrations(current => current.map(item => item.provider === "resend" ? { ...item, status: payload.senderDomainVerified ? "connected" : "needs_attention" } : item));\n      setNotice(payload.message ?? "Resend connection checked. No email was sent.");\n    } catch (reason) {\n      setError(reason instanceof Error ? reason.message : "Could not test the Resend connection.");\n    } finally {\n      setTestingResend(false);\n    }\n  }\n\n  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/integrations/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, displayName: providerFields[provider].label, credentials: values }),
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
                <div className="workspace-integration-row-actions"><span className={item.status === "connected" ? "connection-status" : "status-needs_reauth"}>{item.status.replace("_", " ")}</span>{item.provider === "resend" && <button type="button" onClick={testResend} disabled={testingResend}>{testingResend ? "Testing…" : "Test connection"}</button>}</div>
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
                required
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
    const status = new URLSearchParams(window.location.search).get("google");
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
      </section>

      <WorkspaceIntegrationManager />

      <section className="connections-list">
        <div className="connections-list-heading"><div><h2>Connected accounts</h2><p>Only account details and permission names are shown here. Tokens never reach the browser.</p></div><span>{connections.length} {connections.length === 1 ? "connection" : "connections"}</span></div>
        {loading ? <p className="connections-empty">Loading connections…</p> : connections.length === 0 ? <p className="connections-empty">No Google accounts connected yet.</p> : connections.map(connection => (
          <article className="connection-row" key={connection.id}>
            <div className={`connection-icon ${connection.product === "gmail" ? "google-icon" : "sheets-icon"}`} aria-hidden="true">{connection.product === "gmail" ? "G" : "▦"}</div>
            <div className="connection-row-copy"><strong>{connection.account_email}</strong><span>{connection.product === "gmail" ? "Gmail" : "Google Sheets"} · {connection.scopes.length} permissions</span></div>
            <span className={`connection-status status-${connection.status}`}>{connection.status.replace("_", " ")}</span>
          </article>
        ))}
      </section>
      <p className="connections-footnote">Authorization is separate from workflow execution. A connected account will not trigger a workflow by itself.</p>
    </main>
  );
}
