"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import "./connections.css";

type Connection = {
  id: string;
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

      <section className="connections-list">
        <div className="connections-list-heading"><div><h2>Connected accounts</h2><p>Only account details and permission names are shown here. Tokens never reach the browser.</p></div><span>{connections.length} {connections.length === 1 ? "account" : "accounts"}</span></div>
        {loading ? <p className="connections-empty">Loading connections…</p> : connections.length === 0 ? <p className="connections-empty">No Google accounts connected yet.</p> : connections.map(connection => (
          <article className="connection-row" key={connection.id}>
            <div className="connection-icon google-icon" aria-hidden="true">G</div>
            <div className="connection-row-copy"><strong>{connection.account_email}</strong><span>{connection.scopes.some(scope => scope.includes("gmail")) ? "Gmail" : ""}{connection.scopes.some(scope => scope.includes("spreadsheets")) ? "Google Sheets" : ""} · {connection.scopes.length} permissions</span></div>
            <span className={`connection-status status-${connection.status}`}>{connection.status.replace("_", " ")}</span>
          </article>
        ))}
      </section>
      <p className="connections-footnote">Authorization is separate from workflow execution. A connected account will not trigger a workflow by itself.</p>
    </main>
  );
}
