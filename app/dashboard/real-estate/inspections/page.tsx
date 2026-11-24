"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import DashboardSidebar from "../../dashboard-sidebar";
import "../real-estate.css";

type Lead = { id: string; full_name: string; email: string | null; phone: string | null; consent_to_contact: boolean; contact_preference: string };
type Property = { id: string; reference: string; title: string; location: string; availability_status: string };
type Agent = { id: string; name: string; status: string };
type GoogleConnection = { id: string; product: string; account_email: string; status: string; last_test_status: string | null; scopes: string[] };
type Booking = {
  id: string;
  lead_id: string;
  property_id: string | null;
  agent_id: string | null;
  google_connection_id: string;
  calendar_id: string;
  start_at: string;
  end_at: string;
  time_zone: string;
  customer_invite_requested: boolean;
  customer_invite_email: string | null;
  status: string;
  google_event_id: string | null;
  google_event_url: string | null;
  last_error_code: string | null;
};

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data && typeof data === "object" && "error" in data ? String(data.error) : "Request failed.");
  }
  return data as T;
}
const dateLabel = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const statusLabel = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export default function RealEstateInspectionsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [connections, setConnections] = useState<GoogleConnection[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [leadId, setLeadId] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [googleConnectionId, setGoogleConnectionId] = useState("");
  const [calendarId] = useState("primary");
  const [sendCustomerInvite, setSendCustomerInvite] = useState(false);
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [timeZone, setTimeZone] = useState("Africa/Lagos");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [leadData, propertyData, agentData, connectionData, bookingData] = await Promise.all([
        requestJson<{ leads: Lead[] }>("/api/real-estate/leads?limit=100"),
        requestJson<{ properties: Property[] }>("/api/real-estate/properties"),
        requestJson<{ agents: Agent[] }>("/api/agents"),
        requestJson<{ connections: GoogleConnection[] }>("/api/integrations/google/connections"),
        requestJson<{ bookings: Booking[] }>("/api/real-estate/inspections"),
      ]);
      setLeads(leadData.leads ?? []);
      setProperties((propertyData.properties ?? []).filter((item) => item.availability_status === "available"));
      setAgents((agentData.agents ?? []).filter((item) => item.status === "active"));
      const ready = (connectionData.connections ?? []).filter((item) =>
        item.product === "calendar" && item.status === "connected" && item.last_test_status === "passed" &&
        item.scopes?.includes("https://www.googleapis.com/auth/calendar.events.owned"));
      setConnections(ready);
      setBookings(bookingData.bookings ?? []);
      setGoogleConnectionId((current) => current || ready[0]?.id || "");
      setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone || "Africa/Lagos");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load inspection booking data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function reserve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      if (!startAt || !endAt) throw new Error("Choose an inspection start and end time.");
      const result = await requestJson<{ bookingId: string; status: string }>("/api/real-estate/inspections", {
        method: "POST",
        body: JSON.stringify({
          leadId,
          sendCustomerInvite,
          propertyId: propertyId || null,
          agentId: agentId || null,
          googleConnectionId,
          calendarId,
          startAt: new Date(startAt).toISOString(),
          endAt: new Date(endAt).toISOString(),
          timeZone,
          idempotencyKey: "inspection:" + crypto.randomUUID(),
        }),
      });
      setNotice("Inspection slot reserved for agency approval. No calendar event or invitation has been created yet.");
      setStartAt(""); setEndAt(""); setSendCustomerInvite(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Inspection request failed.");
    } finally {
      setBusy(false);
    }
  }

  async function approve(booking: Booking) {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await requestJson<{ status: string; eventUrl?: string; reconciled?: boolean }>(
        "/api/real-estate/inspections/" + booking.id + "/approve",
        { method: "POST" },
      );
      setNotice(result.reconciled
        ? "Existing Google Calendar event was reconciled. No duplicate was created."
        : "Inspection approved and added to the selected Google Calendar. Customer invitations were not sent.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not approve or reconcile this inspection.");
      await load();
    } finally {
      setBusy(false);
    }
  }

  const leadById = new Map(leads.map((lead) => [lead.id, lead]));
  const propertyById = new Map(properties.map((property) => [property.id, property]));
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const connectionById = new Map(connections.map((connection) => [connection.id, connection]));

  return <main className="app-shell">
    <DashboardSidebar activePage="realestate" />
    <section className="dashboard-main">
      <header className="dashboard-topbar">
        <div className="breadcrumbs">Workspace <span>/</span><Link href="/dashboard/real-estate">Real Estate</Link> <span>/</span><strong>Inspections</strong></div>
        <Link className="subtle-button" href="/dashboard/real-estate">Back to leads ↗</Link>
      </header>
      <div className="dashboard-content">
        <div className="welcome-row">
          <div><div className="dash-eyebrow">REXNORA REAL ESTATE · AUTOMATION 02</div><h1>Property inspections</h1><p>Reserve a proposed slot, then require an agency user to approve it before Rexnora creates the calendar event.</p></div>
        </div>

        {error && <div className="re-alert re-alert-error" role="alert">{error}</div>}
        {notice && <div className="re-alert" role="status">{notice}</div>}

        <section className="re-panel">
          <div className="re-panel-head"><div><h2>Request an inspection</h2><p>Rexnora checks Google Calendar first. Creating a booking here does not create an event or email the customer.</p></div><span className="re-muted-tag">Approval required</span></div>
          {connections.length === 0 ? <div className="re-empty">
            No verified Google Calendar connection with event-write permission was found.
            <p><Link href="/dashboard/connections">Connect and test Google Calendar ↗</Link></p>
          </div> : <form className="re-form" onSubmit={reserve}>
            <div className="re-form-grid">
              <label>Customer / lead
                <select required value={leadId} onChange={(event) => setLeadId(event.target.value)}>
                  <option value="">Choose a lead</option>
                  {leads.map((lead) => <option key={lead.id} value={lead.id}>{lead.full_name}{lead.email ? " · " + lead.email : ""}</option>)}
                </select>
              </label>
              <label>Property (optional)
                <select value={propertyId} onChange={(event) => setPropertyId(event.target.value)}>
                  <option value="">Select later</option>
                  {properties.map((property) => <option key={property.id} value={property.id}>{property.reference} · {property.title} · {property.location}</option>)}
                </select>
              </label>
              <label>Agent (optional)
                <select value={agentId} onChange={(event) => setAgentId(event.target.value)}>
                  <option value="">Assign later</option>
                  {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                </select>
              </label>
              <label>Google Calendar account
                <select required value={googleConnectionId} onChange={(event) => setGoogleConnectionId(event.target.value)}>
                  {connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.account_email}</option>)}
                </select>
              </label>
              <label>Calendar
                <input value={calendarId} readOnly aria-readonly="true" />
              </label>
              <label>Time zone
                <input required maxLength={100} value={timeZone} onChange={(event) => setTimeZone(event.target.value)} />
              </label>
              <label>Start time
                <input type="datetime-local" required value={startAt} onChange={(event) => setStartAt(event.target.value)} />
              </label>
              <label>End time
                <input type="datetime-local" required value={endAt} onChange={(event) => setEndAt(event.target.value)} />
              </label>
              <label className="re-checkbox-field">
                <span>Customer invitation (optional)</span>
                <input
                  type="checkbox"
                  checked={sendCustomerInvite}
                  disabled={!leads.find((lead) => lead.id === leadId)?.email ||
                    !leads.find((lead) => lead.id === leadId)?.consent_to_contact ||
                    leads.find((lead) => lead.id === leadId)?.contact_preference !== "email"}
                  onChange={(event) => setSendCustomerInvite(event.target.checked)}
                />
                <small>Send an email calendar invite only when this lead has recorded email-contact consent</small>
              </label>
            </div>
            <div className="re-form-actions"><button className="re-primary" disabled={busy || loading || connections.length === 0 || !leadId}>{busy ? "Checking calendar…" : "Check availability & reserve slot"}</button></div>
          </form>}
          <p className="re-footnote">After approval, Rexnora creates one event with a stable event ID. Google attendee notifications are disabled; customer invitations are not sent.</p>
        </section>

        <section className="re-panel">
          <div className="re-panel-head"><div><h2>Inspection requests</h2><p>Requested slots, approval state and provider reconciliation.</p></div><button className="re-secondary" onClick={() => void load()} disabled={busy}>Refresh</button></div>
          <div className="re-table-wrap"><table className="re-table">
            <thead><tr><th>Customer</th><th>Property</th><th>Agent</th><th>Inspection time</th><th>Calendar</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>
              {bookings.map((booking) => {
                const lead = leadById.get(booking.lead_id);
                const property = booking.property_id ? propertyById.get(booking.property_id) : null;
                const agent = booking.agent_id ? agentById.get(booking.agent_id) : null;
                const connection = connectionById.get(booking.google_connection_id);
                const canApprove = ["requested", "creating", "unknown"].includes(booking.status);
                return <tr key={booking.id}>
                  <td><strong>{lead?.full_name ?? "Lead"}</strong><small>{booking.id.slice(0, 8)}</small></td>
                  <td>{property?.title ?? "Not selected"}</td>
                  <td>{agent?.name ?? "Unassigned"}</td>
                  <td>{dateLabel(booking.start_at)}<small>to {dateLabel(booking.end_at)} · {booking.time_zone}</small></td>
                  <td>{connection?.account_email ?? booking.calendar_id}<small>{booking.customer_invite_requested ? "Customer invite requested" : "No customer invite"}</small></td>
                  <td><span className={"re-status " + booking.status}>{statusLabel(booking.status)}</span><small>{booking.last_error_code ?? ""}</small></td>
                  <td>{booking.google_event_url
                    ? <a href={booking.google_event_url} target="_blank" rel="noreferrer">Open event ↗</a>
                    : canApprove
                      ? <button className="re-secondary" disabled={busy} onClick={() => void approve(booking)}>{booking.status === "unknown" ? "Reconcile / approve" : booking.status === "creating" ? "Reconcile event" : "Approve & create event"}</button>
                      : "—"}</td>
                </tr>;
              })}
              {!loading && bookings.length === 0 && <tr><td colSpan={7} className="re-empty">No inspection requests yet.</td></tr>}
            </tbody>
          </table></div>
        </section>
      </div>
    </section>
  </main>;
}
