"use client";

import { useEffect, useState } from "react";
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
type WorkspaceIntegration = { id: string; provider: string; status: string; display_name: string; last_test_status: string | null };
type CredentialProvider = "notion" | "discord" | "telegram" | "airtable" | "trello" | "hubspot";
const credentialOptions: Record<CredentialProvider, { label: string; fields: Array<{ key: string; label: string; placeholder: string }> }> = {
  notion: { label: "Notion", fields: [{ key: "apiKey", label: "Internal integration secret", placeholder: "ntn_…" }] },
  discord: { label: "Discord", fields: [{ key: "botToken", label: "Bot token", placeholder: "Discord bot token" }] },
  telegram: { label: "Telegram", fields: [{ key: "botToken", label: "Bot token", placeholder: "123456:…" }] },
  airtable: { label: "Airtable", fields: [{ key: "accessToken", label: "Personal access token", placeholder: "pat…" }] },
  trello: { label: "Trello", fields: [{ key: "apiKey", label: "API key", placeholder: "Trello API key" }, { key: "token", label: "API token", placeholder: "Trello API token" }] },
  hubspot: { label: "HubSpot", fields: [{ key: "accessToken", label: "Private-app access token", placeholder: "pat-…" }] },
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

export default function ConnectionsPage() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [workspaceIntegrations, setWorkspaceIntegrations] = useState<WorkspaceIntegration[]>([]);
  const [credentialProvider, setCredentialProvider] = useState<CredentialProvider>("notion");
  const [credentialValues, setCredentialValues] = useState<Record<string, string>>({});
  const [credentialSaving, setCredentialSaving] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const status = new URLSearchParams(window.location.search).get("google");
    if (status) setNotice(statusMessages[status] ?? "Google authorization returned.");
    Promise.all([
      fetch("/api/integrations/google/connections", { cache: "no-store" }).then(async response => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Could not load Google connections.");
        setConnections(payload.connections ?? []);
      }),
      fetch("/api/integrations/credentials", { cache: "no-store" }).then(async response => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Could not load workspace integrations.");
        setWorkspaceIntegrations(payload.integrations ?? []);
      }),
    ]).catch(reason => setError(reason instanceof Error ? reason.message : "Could not load connections."))
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
          <div className="connection-card-copy"><h2>Gmail</h2><p>Authorize Aivanta to send email from your connected Google account. Every send remains subject to workflow live-execution approval.</p></div>
          <span className="connection-scope">SEND EMAIL</span>
          <a className="connection-button" href="/api/integrations/google/start?product=gmail">Connect Gmail <span aria-hidden="true">↗</span></a>
        </article>
        <article className="connection-card">
          <div className="connection-icon sheets-icon" aria-hidden="true">▦</div>
          <div className="connection-card-copy"><h2>Google Sheets</h2><p>Authorize Aivanta to append rows to selected spreadsheets. Writes remain gated by workflow live-execution approval.</p></div>
          <span className="connection-scope">APPEND ROWS</span>
          <a className="connection-button" href="/api/integrations/google/start?product=sheets">Connect Sheets <span aria-hidden="true">↗</span></a>
        </article>
      </section>

      <section className="workspace-credentials-panel" aria-label="API integrations">
        <div className="connections-list-heading"><div><h2>Connect with API credentials</h2><p>Paste a provider token once. Aivanta tests it using a read-only identity endpoint, then encrypts it for this workspace. Secrets are never shown again.</p></div></div>
        <form className="workspace-credential-form" onSubmit={async event => {
          event.preventDefault();
          if (credentialSaving) return;
          setCredentialSaving(true); setError(""); setNotice("");
          try {
            const response = await fetch("/api/integrations/credentials", {
              method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
              body: JSON.stringify({ provider: credentialProvider, credentials: credentialValues }),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error ?? "Connection test failed.");
            setCredentialValues({});
            setNotice(credentialOptions[credentialProvider].label + " connected and its credentials were encrypted for this workspace.");
            const refreshed = await fetch("/api/integrations/credentials", { cache: "no-store" });
            const refreshedPayload = await refreshed.json();
            if (refreshed.ok) setWorkspaceIntegrations(refreshedPayload.integrations ?? []);
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : "Could not connect this provider.");
          } finally { setCredentialSaving(false); }
        }}>
          <label htmlFor="credential-provider">Provider</label>
          <select id="credential-provider" value={credentialProvider} onChange={event => { setCredentialProvider(event.target.value as CredentialProvider); setCredentialValues({}); }}>
            {Object.entries(credentialOptions).map(([key, option]) => <option key={key} value={key}>{option.label}</option>)}
          </select>
          {credentialOptions[credentialProvider].fields.map(field => <label className="credential-field" key={field.key}>
            <span>{field.label}</span>
            <input type="password" autoComplete="new-password" spellCheck={false} required value={credentialValues[field.key] ?? ""} placeholder={field.placeholder} onChange={event => setCredentialValues(current => ({ ...current, [field.key]: event.target.value }))} />
          </label>)}
          <button className="connection-button" type="submit" disabled={credentialSaving}>{credentialSaving ? "Testing and securing…" : "Test & save connection"} <span aria-hidden="true">↗</span></button>
          <p className="credential-security-note">Connection testing does not create records or send messages. Live workflow actions are separately disabled until explicitly allowlisted.</p>
        </form>
        <div className="workspace-integrations-list">
          {workspaceIntegrations.map(integration => <article className="connection-row" key={integration.id}>
            <div className="connection-row-copy"><strong>{integration.display_name}</strong><span>{integration.provider} · connection test {integration.last_test_status ?? "not run"}</span></div>
            <span className={"connection-status status-" + integration.status}>{integration.status.replace("_", " ")}</span>
            <button type="button" className="connection-disconnect" onClick={async () => {
              const response = await fetch("/api/integrations/credentials?provider=" + encodeURIComponent(integration.provider), { method: "DELETE" });
              const payload = await response.json();
              if (!response.ok) { setError(payload.error ?? "Could not disconnect provider."); return; }
              setWorkspaceIntegrations(current => current.filter(item => item.id !== integration.id));
              setNotice(integration.provider + " disconnected from this workspace.");
            }}>Disconnect</button>
          </article>)}
          {!loading && workspaceIntegrations.length === 0 && <p className="connections-empty">No API-key integrations connected yet.</p>}
        </div>
      </section>

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
