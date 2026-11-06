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

const statusMessages: Record<string, string> = {
  connected: "Google account authorized. Credentials are stored encrypted on the server.",
  cancelled: "Authorization was cancelled. No connection was added.",
  invalid_state: "The authorization response could not be verified. Start again for your security.",
  sign_in_required: "Your session expired. Sign in and try again.",
  user_changed: "The signed-in account changed during authorization. Start again.",
  token_exchange_failed: "Google could not complete authorization. Check the OAuth client and redirect URI configuration.",
  profile_failed: "A verified Google account profile could not be confirmed.",
  server_not_configured: "Connection storage is not configured for this environment.",
  save_failed: "Google authorization completed, but Aivanta could not save the connection. See the diagnostic code below.",
  connection_failed: "The connection could not be completed. No credentials were shown.",
  not_configured: "Google OAuth is not configured for this environment yet.",
  scope_mismatch: "Google returned permissions that do not match the requested read-only access.",
};

const diagnosticHelp: Record<string, string> = {
  CONNECTION_AUTH_REQUIRED: "Your Aivanta session is missing or expired. Sign in again.",
  CONNECTION_STORAGE_NOT_CONFIGURED: "The Preview deployment is missing a Supabase URL or server-side service key.",
  CONNECTION_TABLE_MISSING: "The google_connections table is missing from the configured Supabase project. Confirm the Phase 0 migrations were applied to this project.",
  CONNECTION_QUERY_FAILED: "Supabase rejected the connection query. Check the Preview service key, project URL, grants, and RLS configuration.",
  CONNECTIONS_UNAVAILABLE: "The server failed before it could load workspace connections. Check the Preview function logs.",
};

export default function ConnectionsPage() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [workflowId, setWorkflowId] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedWorkflow = params.get("workflowId");
    let rememberedWorkflow = "";
    try { rememberedWorkflow = window.sessionStorage.getItem("aivanta-return-workflow") || ""; } catch { /* Continue without a remembered return target. */ }
    const nextWorkflow = requestedWorkflow && /^[0-9a-f-]{36}$/i.test(requestedWorkflow) ? requestedWorkflow : rememberedWorkflow;
    if (nextWorkflow) {
      setWorkflowId(nextWorkflow);
      try { window.sessionStorage.setItem("aivanta-return-workflow", nextWorkflow); } catch { /* Current-page state remains available. */ }
    }

    const status = params.get("google");
    if (status) setNotice(statusMessages[status] ?? "Google authorization returned.");
    fetch("/api/integrations/google/connections", { cache: "no-store" })
      .then(async response => {
        const payload = await response.json();
        if (!response.ok) {
          setErrorCode(typeof payload.code === "string" ? payload.code : "CONNECTIONS_UNAVAILABLE");
          throw new Error(payload.error ?? "Could not load connections.");
        }
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
        {workflowId && <Link className="connections-return" href={`/dashboard/workflows/${workflowId}`}>Return to your workflow <span aria-hidden="true">→</span></Link>}
      </section>

      {notice && <p className="connections-notice" role="status">{notice}</p>}
      {error && <div className="connections-error" role="alert">
        <strong>Connections unavailable</strong>
        <p>{error}</p>
        <small>Diagnostic: {errorCode || "CONNECTIONS_UNAVAILABLE"}</small>
        {diagnosticHelp[errorCode] && <p>{diagnosticHelp[errorCode]}</p>}
        <button type="button" onClick={() => window.location.reload()}>Try again</button>
      </div>}

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
