"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import DashboardSidebar from "../../dashboard-sidebar";
import "../real-estate.css";

type Lead = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  contact_preference: string;
  consent_to_contact: boolean;
  lead_score: number;
};
type CalendarConnection = {
  id: string;
  product: string;
  account_email: string;
  status: string;
  last_test_status: string | null;
};
type Agent = { id: string; name: string; status: string };
type Property = { id: string; reference: string; title: string; availability_status: string; available: boolean };
type Booking = {
  id: string;
  lead_id: string;
  property_id: string | null;
  agent_id: string | null;
  calendar_id: string;
  start_at: string;
  end_at: string;
  time_zone: string;
  customer_invite_requested: boolean;
  status: string;
  google_event_url: string | null;
  last_error_code: string | null;
  lead: { full_name: string; email: string | null } | null;
};
type Task = {
  id: string;
  lead_id: string;
  task_type: string;
  title: string;
  description: string;
  status: "open" | "in_progress" | "completed" | "cancelled";
  priority: string;
  due_at: string;
  lead: { full_name: string; email: string | null; lead_score: number } | null;
};

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store", headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  let payload: unknown;
  try { payload = await response.json(); } catch { payload = {}; }
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload ? String((payload as { error: unknown }).error) : "Request failed.";
    throw new Error(message);
  }
  return payload as T;
}
const dateLabel = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const human = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
function localDateTime(hoursAhead: number) {
  const date = new Date(Date.now() + hoursAhead * 60 * 60 * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + "T" + pad(date.getHours()) + ":" + pad(date.getMinutes());
}
function newIdempotencyKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : "rexnora-" + Date.now() + "-" + Math.random().toString(36).slice(2);
}

export default function RealEstateOperationsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [connections, setConnections] = useState<CalendarConnection[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [leadId, setLeadId] = useState("");
  const [calendarConnectionId, setCalendarConnectionId] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [calendarId, setCalendarId] = useState("primary");
  const [startAt, setStartAt] = useState(() => localDateTime(26));
  const [durationMinutes, setDurationMinutes] = useState("60");
  const [inviteCustomer, setInviteCustomer] = useState(false);
  const [activeSection, setActiveSection] = useState<"inspections" | "tasks">("inspections");

  const selectedLead = useMemo(() => leads.find((lead) => lead.id === leadId) ?? null, [leads, leadId]);
  const eligibleCalendarConnections = useMemo(
    () => connections.filter((connection) => connection.product === "calendar" && connection.status === "connected" && connection.last_test_status === "passed"),
    [connections],
  );
  const canInviteCustomer = Boolean(selectedLead?.email && selectedLead.consent_to_contact && selectedLead.contact_preference === "email");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [leadData, connectionData, bookingData, taskData, agentData, propertyData] = await Promise.all([
        requestJson<{ leads: Lead[] }>("/api/real-estate/leads?limit=100"),
        requestJson<{ connections: CalendarConnection[] }>("/api/integrations/google/connections"),
        requestJson<{ bookings: Booking[] }>("/api/real-estate/inspections"),
        requestJson<{ tasks: Task[] }>("/api/real-estate/tasks"),
        requestJson<{ agents: Agent[] }>("/api/agents"),
        requestJson<{ properties: Property[] }>("/api/real-estate/properties"),
      ]);
      setLeads(leadData.leads ?? []);
      setConnections(connectionData.connections ?? []);
      setBookings(bookingData.bookings ?? []);
      setTasks(taskData.tasks ?? []);
      setAgents((agentData.agents ?? []).filter((agent) => agent.status === "active"));
      setProperties((propertyData.properties ?? []).filter((property) => property.available && property.availability_status === "available"));
      if (!calendarConnectionId && (connectionData.connections ?? []).some((connection) =>
        connection.product === "calendar" && connection.status === "connected" && connection.last_test_status === "passed")) {
        const chosen = (connectionData.connections ?? []).find((connection) =>
          connection.product === "calendar" && connection.status === "connected" && connection.last_test_status === "passed");
        if (chosen) setCalendarConnectionId(chosen.id);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load real-estate operations.");
    } finally {
      setLoading(false);
    }
  }, [calendarConnectionId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (window.location.hash === "#tasks") setActiveSection("tasks"); }, []);

  async function createBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      if (!leadId || !calendarConnectionId) throw new Error("Select a customer enquiry and a verified Google Calendar.");
      const start = new Date(startAt);
      const duration = Number(durationMinutes);
      if (!Number.isFinite(start.getTime()) || !Number.isInteger(duration) || duration < 5 || duration > 180) {
        throw new Error("Choose a valid future time and a duration from 5 to 180 minutes.");
      }
      const end = new Date(start.getTime() + duration * 60_000);
      const body = {
        leadId,
        googleConnectionId: calendarConnectionId,
        propertyId: propertyId || null,
        agentId: agentId || null,
        calendarId: calendarId.trim() || "primary",
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        sendCustomerInvite: inviteCustomer && canInviteCustomer,
        idempotencyKey: newIdempotencyKey(),
      };
      const result = await requestJson<{ booking: Booking; message: string }>("/api/real-estate/inspections", {
        method: "POST", body: JSON.stringify(body),
      });
      setNotice(result.message || "Inspection slot reserved. It is waiting for an owner/admin to approve Calendar event creation.");
      setInviteCustomer(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reserve this inspection.");
    } finally {
      setBusy(false);
    }
  }

  async function approveBooking(booking: Booking) {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await requestJson<{ status: string; eventUrl?: string | null; alreadyConfirmed?: boolean }>(
        "/api/real-estate/inspections/" + encodeURIComponent(booking.id) + "/approve",
        { method: "POST", body: JSON.stringify({}) },
      );
      setNotice(result.alreadyConfirmed ? "This inspection is already confirmed." : "Calendar event created and inspection confirmed.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Calendar approval failed. Check the booking state before retrying.");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function updateTask(task: Task, status: Task["status"]) {
    setBusy(true); setError(""); setNotice("");
    try {
      await requestJson("/api/real-estate/tasks/" + encodeURIComponent(task.id), {
        method: "PATCH", body: JSON.stringify({ status }),
      });
      setNotice("Task updated.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Task update failed.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="app-shell re-shell">
    <DashboardSidebar activePage="realestate" />
    <section className="dashboard-main">
      <header className="dashboard-topbar"><div className="breadcrumbs">Workspace / Real Estate / <strong>Operations</strong></div><span className="environment-badge">Agency operations</span></header>
      <div className="dashboard-content re-content">
        <div className="re-heading">
          <div><div className="dash-eyebrow">REAL ESTATE WORKSPACE</div><h1>Operations</h1><p>Book inspections, approve customer-facing actions and manage the work created from enquiries.</p></div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link className="re-secondary" href="/dashboard/real-estate">Lead management</Link>
            <Link className="re-secondary" href="/dashboard/connections">Connections</Link>
          </div>
        </div>
        {error && <div className="re-alert re-error" role="alert">{error}</div>}
        {notice && <div className="re-alert" role="status">{notice}<button onClick={() => setNotice("")} aria-label="Dismiss message">×</button></div>}
        <div className="re-tabs" role="tablist" aria-label="Real-estate operations">
          <button role="tab" aria-selected={activeSection === "inspections"} className={activeSection === "inspections" ? "active" : ""} onClick={() => setActiveSection("inspections")}>Inspection bookings ({bookings.length})</button>
          <button role="tab" aria-selected={activeSection === "tasks"} className={activeSection === "tasks" ? "active" : ""} onClick={() => setActiveSection("tasks")}>Back-office tasks ({tasks.filter((task) => !["completed", "cancelled"].includes(task.status)).length})</button>
        </div>

        {activeSection === "inspections" && <>
          <section className="re-panel" style={{ marginBottom: 16 }}>
            <div className="re-panel-head"><div><h2>Reserve a property inspection</h2><p>Rexnora checks the selected Google Calendar before reserving the slot. Event creation requires a separate owner/admin approval.</p></div></div>
            {eligibleCalendarConnections.length === 0 ? <div style={{ padding: 18 }}>
              <p className="re-empty">No tested Google Calendar connection is available in this workspace.</p>
              <Link className="re-primary" href="/dashboard/connections">Connect Google Calendar</Link>
            </div> : <form className="re-form" onSubmit={createBooking}>
              <div className="re-form-grid">
                <label>Customer enquiry
                  <select required value={leadId} onChange={(event) => { setLeadId(event.target.value); setInviteCustomer(false); }}>
                    <option value="">Select a lead</option>
                    {leads.map((lead) => <option key={lead.id} value={lead.id}>{lead.full_name}{lead.email ? " · " + lead.email : ""}</option>)}
                  </select>
                </label>
                <label>Google Calendar account
                  <select required value={calendarConnectionId} onChange={(event) => setCalendarConnectionId(event.target.value)}>
                    <option value="">Select a connected calendar</option>
                    {eligibleCalendarConnections.map((connection) => <option key={connection.id} value={connection.id}>{connection.account_email}</option>)}
                  </select>
                </label>
                <label>Calendar ID<input value={calendarId} maxLength={300} onChange={(event) => setCalendarId(event.target.value)} placeholder="primary" /></label>
                <label>Property listing (optional)
                  <select value={propertyId} onChange={(event) => setPropertyId(event.target.value)}>
                    <option value="">No specific property selected</option>
                    {properties.map((property) => <option key={property.id} value={property.id}>{property.reference} · {property.title}</option>)}
                  </select>
                </label>
                <label>Assigned agent (optional)
                  <select value={agentId} onChange={(event) => setAgentId(event.target.value)}>
                    <option value="">Unassigned</option>
                    {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                  </select>
                </label>
                <label>Inspection date and time<input required type="datetime-local" value={startAt} onChange={(event) => setStartAt(event.target.value)} /></label>
                <label>Duration
                  <select value={durationMinutes} onChange={(event) => setDurationMinutes(event.target.value)}>
                    {[15, 30, 45, 60, 90, 120, 180].map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}
                  </select>
                </label>
              </div>
              <label className="re-consent"><input type="checkbox" checked={inviteCustomer} disabled={!canInviteCustomer} onChange={(event) => setInviteCustomer(event.target.checked)} /> Send the customer a Calendar invitation {selectedLead ? canInviteCustomer ? "— email consent is recorded." : "— requires email contact consent for this lead." : "— select a customer first."}</label>
              <p className="re-footnote">Times are interpreted in your browser time zone ({Intl.DateTimeFormat().resolvedOptions().timeZone || "local time"}). A reserved slot is not a confirmed Calendar event.</p>
              <div className="re-form-actions"><button className="re-primary" disabled={busy || !leadId || !calendarConnectionId}>{busy ? "Checking availability…" : "Check availability & reserve slot"}</button></div>
            </form>}
          </section>
          <section className="re-panel">
            <div className="re-panel-head"><div><h2>Inspection bookings</h2><p>Approve a reserved slot to create the Google Calendar event. Unknown outcomes can be safely reconciled using the same event ID. A definite failure needs a new booking after the underlying issue is fixed.</p></div><button className="re-secondary" onClick={() => void load()} disabled={loading}>Refresh</button></div>
            <div className="re-table-wrap"><table className="re-table"><thead><tr><th>Customer</th><th>Inspection time</th><th>Calendar</th><th>Status</th><th>Action</th></tr></thead><tbody>
              {bookings.map((booking) => <tr key={booking.id}>
                <td><strong>{booking.lead?.full_name ?? "Unknown lead"}</strong><small>{booking.lead?.email ?? "No email"}</small></td>
                <td>{dateLabel(booking.start_at)}<small>{booking.time_zone} · {dateLabel(booking.end_at)}</small></td>
                <td>{booking.calendar_id}</td>
                <td><span className={"re-status " + booking.status}>{human(booking.status)}</span>{booking.last_error_code && <small>{booking.last_error_code}</small>}</td>
                <td>{booking.google_event_url ? <a className="re-link" href={booking.google_event_url} target="_blank" rel="noreferrer">Open event ↗</a> :
                  ["requested", "unknown"].includes(booking.status) ? <button className="re-small" disabled={busy} onClick={() => void approveBooking(booking)}>Approve & create event</button> :
                  booking.status === "creating" ? <span>In progress</span> : "—"}</td>
              </tr>)}
              {!loading && !bookings.length && <tr><td colSpan={5} className="re-empty">No inspection bookings yet.</td></tr>}
            </tbody></table></div>
          </section>
        </>}

        {activeSection === "tasks" && <section className="re-panel">
          <div className="re-panel-head"><div><h2>Back-office task queue</h2><p>New enquiries create a deduplicated review task. Confirmed inspections create preparation tasks.</p></div><button className="re-secondary" onClick={() => void load()} disabled={loading}>Refresh</button></div>
          <div className="re-table-wrap"><table className="re-table"><thead><tr><th>Task</th><th>Customer</th><th>Priority</th><th>Due</th><th>Status</th><th>Update</th></tr></thead><tbody>
            {tasks.map((task) => <tr key={task.id}>
              <td><strong>{task.title}</strong><small>{human(task.task_type)} · {task.description}</small></td>
              <td>{task.lead?.full_name ?? "Unknown lead"}<small>{task.lead?.email ?? ""}</small></td>
              <td><span className={"re-status " + task.priority}>{human(task.priority)}</span></td>
              <td>{dateLabel(task.due_at)}</td>
              <td><span className={"re-status " + task.status}>{human(task.status)}</span></td>
              <td><select className="re-inline-select" disabled={busy} value={task.status} onChange={(event) => void updateTask(task, event.target.value as Task["status"])}>
                <option value="open">Open</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option>
              </select></td>
            </tr>)}
            {!loading && !tasks.length && <tr><td colSpan={6} className="re-empty">No back-office tasks yet. New enquiry qualification creates the first review task automatically.</td></tr>}
          </tbody></table></div>
        </section>}
        {loading && <p className="re-loading">Loading operations…</p>}
        <footer className="re-footer">Rexnora Real Estate · Workspace-scoped bookings and staff tasks</footer>
      </div>
    </section>
  </main>;
}
