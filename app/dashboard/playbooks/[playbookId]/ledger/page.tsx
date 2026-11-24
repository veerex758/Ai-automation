"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import DashboardSidebar from "../../../dashboard-sidebar";
import "../../playbooks.css";

type Event = { id: string; leadId: string; leadName: string; type: string; details: Record<string, unknown>; createdAt: string };
type Delivery = { id: string; leadId: string; leadName: string; sequence: number; status: string; dueAt: string; sentAt: string | null; errorCode: string | null; attempts: number };
type ChannelDelivery = { id: string; leadName: string; channel: string; status: string; errorCode: string | null; createdAt: string; acceptedAt: string | null };
type Inspection = { id: string; leadName: string; startAt: string; endAt: string; status: string; eventUrl: string | null; customerInviteRequested: boolean; errorCode: string | null };
type BackOfficeTask = { id: string; leadName: string; title: string; status: string; priority: string; dueAt: string; completedAt: string | null };
type Result = { events?: Event[]; delivery?: Delivery[]; channels?: ChannelDelivery[]; bookings?: Inspection[]; tasks?: BackOfficeTask[]; leadCount?: number; error?: string };

const date = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const humanize = (value: string) => value.replaceAll("_", " ").replaceAll(".", " · ");

export default function PlaybookOutcomeLedgerPage() {
  const params = useParams<{ playbookId: string }>();
  const playbookId = params.playbookId;
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await fetch("/api/real-estate/playbooks/ledger?workflowId=" + encodeURIComponent(playbookId), { cache: "no-store" });
        const data = await response.json() as Result;
        if (!response.ok) throw new Error(data.error || "Could not load the ledger.");
        if (active) setResult(data);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Could not load the ledger.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [playbookId]);

  return <main className="app-shell playbook-shell">
    <DashboardSidebar activePage="playbooks" />
    <section className="dashboard-main">
      <header className="dashboard-topbar">
        <div className="breadcrumbs">Workspace <span>/</span><Link href={"/dashboard/playbooks/" + encodeURIComponent(playbookId)}>Control Room</Link><span>/</span><strong>Outcome Ledger</strong></div>
        <span className="environment-badge">Read-only history</span>
      </header>
      <div className="dashboard-content playbook-content">
        <div className="playbook-heading">
          <div className="playbook-eyebrow">REXNORA PLAYBOOKS · OUTCOME LEDGER</div>
          <h1>What happened to each enquiry?</h1>
          <p>A workspace-scoped record of qualification, provider delivery, inspection bookings, internal tasks and follow-up outcomes. Entries are read-only.</p>
        </div>
        <div className="playbook-alert">Provider requests and customer notifications are recorded separately from internal activity. A queued or accepted status is not a guarantee that the customer has responded.</div>
        {loading && <div className="playbook-panel">Loading outcome history…</div>}
        {error && <div className="playbook-alert error" role="alert">{error}</div>}
        {!loading && !error && result && <>
          <div className="playbook-steps">
            <div className="playbook-step"><span>{result.leadCount ?? 0}</span><div><strong>Enquiries</strong><small>Linked to this Playbook</small></div></div>
            <div className="playbook-step"><span>{result.events?.length ?? 0}</span><div><strong>Recorded events</strong><small>Append-only activity history</small></div></div>
            <div className="playbook-step"><span>{result.delivery?.length ?? 0}</span><div><strong>Email follow-ups</strong><small>Delivery and retry status</small></div></div>
            <div className="playbook-step"><span>{result.channels?.length ?? 0}</span><div><strong>Channel deliveries</strong><small>WhatsApp template status</small></div></div>
            <div className="playbook-step"><span>{result.bookings?.length ?? 0}</span><div><strong>Inspections</strong><small>Calendar reservation status</small></div></div>
            <div className="playbook-step"><span>{result.tasks?.length ?? 0}</span><div><strong>Back-office tasks</strong><small>Agency task completion</small></div></div>
          </div>
          <section className="playbook-panel">
            <div className="playbook-panel-heading"><span>01</span><div><h2>Enquiry activity</h2><p>Qualification, assignment, customer response and other recorded events.</p></div></div>
            {result.events?.length ? <div className="playbook-rule-list">{result.events.map((event) => <article className="playbook-rule-card" key={event.id}>
              <div className="playbook-rule-index">↳</div>
              <div className="playbook-rule-fields">
                <div><strong>{event.leadName}</strong><small>{humanize(event.type)} · {date(event.createdAt)}</small></div>
                <p>{Object.keys(event.details ?? {}).length ? Object.entries(event.details).map(([key, value]) => key + ": " + (typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : JSON.stringify(value))).join(" · ") : "No additional details recorded."}</p>
              </div>
            </article>)}</div> : <div className="playbook-empty">No activity is linked to this Playbook yet. Enquiries will appear after a real-estate lead is assigned to this saved Playbook.</div>}
          </section>
          <section className="playbook-panel">
            <div className="playbook-panel-heading"><span>02</span><div><h2>Follow-up delivery</h2><p>Delivery state and retry history for existing agency follow-ups.</p></div></div>
            {result.delivery?.length ? result.delivery.map((item) => <article className="playbook-action-card" key={item.id}>
              <div className="playbook-action-copy"><strong>{item.leadName} · follow-up {item.sequence}</strong><small>Due {date(item.dueAt)}{item.sentAt ? " · Sent " + date(item.sentAt) : ""}</small></div>
              <span className="playbook-draft-tag">{humanize(item.status)}{item.errorCode ? " · " + item.errorCode : ""} · {item.attempts} attempts</span>
            </article>) : <div className="playbook-empty">No follow-up messages are linked to this Playbook yet.</div>}
          </section>
          <section className="playbook-panel">
            <div className="playbook-panel-heading"><span>03</span><div><h2>WhatsApp delivery</h2><p>Consent-gated template sends and delivery reconciliation.</p></div></div>
            {result.channels?.length ? result.channels.map((item) => <article className="playbook-action-card" key={item.id}>
              <div className="playbook-action-copy"><strong>{item.leadName} · {humanize(item.channel)}</strong><small>{date(item.createdAt)}{item.acceptedAt ? " · Accepted " + date(item.acceptedAt) : ""}</small></div>
              <span className="playbook-draft-tag">{humanize(item.status)}{item.errorCode ? " · " + item.errorCode : ""}</span>
            </article>) : <div className="playbook-empty">No WhatsApp delivery attempts are recorded.</div>}
          </section>
          <section className="playbook-panel">
            <div className="playbook-panel-heading"><span>04</span><div><h2>Property inspections</h2><p>Requested reservations, agency approval and Google Calendar confirmation.</p></div></div>
            {result.bookings?.length ? result.bookings.map((item) => <article className="playbook-action-card" key={item.id}>
              <div className="playbook-action-copy"><strong>{item.leadName} · {humanize(item.status)}</strong><small>{date(item.startAt)} – {date(item.endAt)} · Customer invite {item.customerInviteRequested ? "requested" : "not requested"}</small></div>
              <span className="playbook-draft-tag">{item.errorCode ? item.errorCode : item.eventUrl ? <a href={item.eventUrl} target="_blank" rel="noreferrer">Open calendar event</a> : "No external event confirmed"}</span>
            </article>) : <div className="playbook-empty">No inspection bookings are recorded.</div>}
          </section>
          <section className="playbook-panel">
            <div className="playbook-panel-heading"><span>05</span><div><h2>Back-office tasks</h2><p>Internal follow-up work created for the agency.</p></div></div>
            {result.tasks?.length ? result.tasks.map((item) => <article className="playbook-action-card" key={item.id}>
              <div className="playbook-action-copy"><strong>{item.leadName} · {item.title}</strong><small>Due {date(item.dueAt)}{item.completedAt ? " · Completed " + date(item.completedAt) : ""}</small></div>
              <span className="playbook-draft-tag">{humanize(item.status)} · {humanize(item.priority)}</span>
            </article>) : <div className="playbook-empty">No back-office tasks are recorded.</div>}
          </section>
        </>}
      </div>
    </section>
  </main>;
}
