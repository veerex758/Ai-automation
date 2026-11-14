"use client";
import { useCallback, useEffect, useState } from "react";

type Destination = { id: string; channel: "email" | "slack"; destination: string; enabled: boolean };
type Preferences = { enabled: boolean; events: string[]; minimum_severity: "warning" | "critical" };
type Delivery = { id: string; event_key: string; channel: string; status: string; error_code: string | null; created_at: string };
const EVENT_OPTIONS = [
  ["queue_backlog", "Queue backlog"],
  ["dead_letter", "Dead-letter jobs"],
  ["worker_offline", "Worker offline"],
  ["workflow_failures", "Workflow failures"],
  ["provider_failure", "Provider connection failures"],
] as const;
export default function AlertSettings({ workspaceId }: { workspaceId: string }) {
  const [preferences, setPreferences] = useState<Preferences>({ enabled: true, events: EVENT_OPTIONS.map(([key]) => key), minimum_severity: "warning" });
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [channel, setChannel] = useState<"email" | "slack">("email");
  const [destination, setDestination] = useState("");
  const [webhook, setWebhook] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    const response = await fetch("/api/workspaces/" + workspaceId + "/alerts", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load alert settings.");
    setPreferences(data.preferences);
    setDestinations(data.destinations ?? []);
    setDeliveries(data.recent_deliveries ?? []);
  }, [workspaceId]);
  useEffect(() => { void load().catch((e) => setError(e instanceof Error ? e.message : "Could not load alert settings.")); }, [load]);
  async function savePreferences() {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/workspaces/" + workspaceId + "/alerts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(preferences) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save preferences.");
      setPreferences(data.preferences); setNotice("Alert preferences saved.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save preferences."); }
    finally { setBusy(false); }
  }
  async function addDestination() {
    setBusy(true); setError(""); setNotice("");
    try {
      const body = channel === "email" ? { channel, destination } : { channel, webhook_url: webhook };
      const response = await fetch("/api/workspaces/" + workspaceId + "/alerts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not add destination.");
      setDestination(""); setWebhook(""); await load(); setNotice("Alert destination added.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not add destination."); }
    finally { setBusy(false); }
  }
  async function removeDestination(id: string) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/workspaces/" + workspaceId + "/alerts?id=" + encodeURIComponent(id), { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not remove destination.");
      await load(); setNotice("Alert destination removed.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not remove destination."); }
    finally { setBusy(false); }
  }
  return <section className="operations-panel" style={{ marginTop: 18 }}>
    <h2>Alert delivery settings</h2>
    <p>Send operational alerts to workspace email addresses or a Slack incoming webhook. Slack URLs are encrypted at rest.</p>
    {error && <p className="operations-error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <label style={{ display: "flex", gap: 10, alignItems: "center" }}><input type="checkbox" checked={preferences.enabled} onChange={(e) => setPreferences({ ...preferences, enabled: e.target.checked })} /> Enable external operational alerts</label>
    <label>Minimum severity <select value={preferences.minimum_severity} onChange={(e) => setPreferences({ ...preferences, minimum_severity: e.target.value as Preferences["minimum_severity"] })}><option value="warning">Warning and critical</option><option value="critical">Critical only</option></select></label>
    <div style={{ display: "grid", gap: 8, margin: "12px 0" }}>
      {EVENT_OPTIONS.map(([key, label]) => <label key={key} style={{ display: "flex", gap: 10, alignItems: "center" }}><input type="checkbox" checked={preferences.events.includes(key)} onChange={(e) => setPreferences({ ...preferences, events: e.target.checked ? [...preferences.events, key] : preferences.events.filter((item) => item !== key) })} />{label}</label>)}
    </div>
    <button onClick={() => void savePreferences()} disabled={busy}>Save alert preferences</button>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "end", marginTop: 18 }}>
      <label>Channel <select value={channel} onChange={(e) => setChannel(e.target.value as "email" | "slack")}><option value="email">Email</option><option value="slack">Slack</option></select></label>
      {channel === "email" ? <label>Email address <input type="email" value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="ops@company.com" /></label> : <label>Slack webhook URL <input type="password" value={webhook} onChange={(e) => setWebhook(e.target.value)} placeholder="https://hooks.slack.com/services/…" /></label>}
      <button onClick={() => void addDestination()} disabled={busy || (channel === "email" ? !destination.trim() : !webhook.trim())}>Add destination</button>
    </div>
    <h3>Destinations</h3>
    {destinations.length ? destinations.map((item) => <div className="operations-row" key={item.id}><div><strong>{item.channel === "slack" ? "Slack" : item.destination}</strong><small>{item.channel === "slack" ? "Encrypted incoming webhook" : "Email alerts"}</small></div><button onClick={() => void removeDestination(item.id)} disabled={busy}>Remove</button></div>) : <p>No external alert destinations configured.</p>}
    <h3>Recent delivery attempts</h3>
    {deliveries.length ? deliveries.slice(0, 10).map((item) => <div className="operations-row" key={item.id}><div><strong>{item.event_key} · {item.channel}</strong><small>{new Date(item.created_at).toLocaleString()}{item.error_code ? " · " + item.error_code : ""}</small></div><span>{item.status}</span></div>) : <p>No alert delivery attempts recorded.</p>}
    <p className="operations-footnote">Email delivery requires RESEND_API_KEY and RESEND_FROM_EMAIL. Slack delivery uses the saved encrypted webhook. A scheduled request to /api/internal/operations/alerts runs evaluation and delivery; protect it with CRON_SECRET.</p>
  </section>;
}
