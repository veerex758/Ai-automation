"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import DashboardSidebar from "../../dashboard-sidebar";
import "../real-estate.css";

type Task = {
  id: string;
  lead_id: string;
  assigned_agent_id: string | null;
  task_type: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  due_at: string;
  completed_at: string | null;
  lead: { id: string; full_name: string; email: string | null; lead_score: number; lead_temperature: string } | null;
  agent: { id: string; name: string } | null;
};
type Agent = { id: string; name: string; status: string };

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init, cache: "no-store",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data && typeof data === "object" && "error" in data ? String(data.error) : "Request failed.");
  return data as T;
}
const label = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const dateLabel = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export default function RealEstateTasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [taskData, agentData] = await Promise.all([
        requestJson<{ tasks: Task[] }>("/api/real-estate/tasks"),
        requestJson<{ agents: Agent[] }>("/api/agents"),
      ]);
      setTasks(taskData.tasks ?? []);
      setAgents((agentData.agents ?? []).filter((agent) => agent.status === "active"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load back-office tasks.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function update(task: Task, fields: Record<string, unknown>) {
    setBusyId(task.id); setError(""); setNotice("");
    try {
      await requestJson("/api/real-estate/tasks", {
        method: "PATCH",
        body: JSON.stringify({ taskId: task.id, ...fields }),
      });
      setNotice("Back-office task updated.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Task update failed.");
    } finally { setBusyId(""); }
  }

  const openCount = tasks.filter((task) => ["open", "in_progress"].includes(task.status)).length;
  const overdueCount = tasks.filter((task) => ["open", "in_progress"].includes(task.status) && Date.parse(task.due_at) < Date.now()).length;

  return <main className="app-shell">
    <DashboardSidebar activePage="realestate" />
    <section className="dashboard-main">
      <header className="dashboard-topbar">
        <div className="breadcrumbs">Workspace <span>/</span><Link href="/dashboard/real-estate">Real Estate</Link> <span>/</span><strong>Back-office tasks</strong></div>
        <Link className="subtle-button" href="/dashboard/real-estate">Back to leads ↗</Link>
      </header>
      <div className="dashboard-content">
        <div className="welcome-row">
          <div><div className="dash-eyebrow">REXNORA REAL ESTATE · AUTOMATION 04</div><h1>Back-office tasks</h1><p>Every qualified enquiry gets one workspace task for review. Assign an agent, set priority and close the loop.</p></div>
          <Link className="create-button" href="/dashboard/real-estate/inspections">Property inspections ↗</Link>
        </div>
        {error && <div className="re-alert re-alert-error" role="alert">{error}</div>}
        {notice && <div className="re-alert" role="status">{notice}</div>}
        <div className="re-stats">
          <article><span>Tasks</span><strong>{tasks.length}</strong><small>All recorded tasks</small></article>
          <article><span>Open</span><strong>{openCount}</strong><small>Need action</small></article>
          <article><span>Overdue</span><strong>{overdueCount}</strong><small>Past due date</small></article>
        </div>
        <section className="re-panel">
          <div className="re-panel-head"><div><h2>Agency action queue</h2><p>Task records are deduplicated by lead and workspace. Update status and assignment here.</p></div><button className="re-secondary" onClick={() => void load()} disabled={busyId !== ""}>Refresh</button></div>
          <div className="re-table-wrap"><table className="re-table">
            <thead><tr><th>Task / lead</th><th>Priority</th><th>Due</th><th>Assigned agent</th><th>Status</th></tr></thead>
            <tbody>
              {tasks.map((task) => <tr key={task.id}>
                <td><strong>{task.title}</strong><small>{task.lead?.full_name ?? "Lead"} · {task.lead?.email ?? "No email"}</small><small>{task.description}</small></td>
                <td><select className="re-inline-select" disabled={busyId === task.id} value={task.priority} onChange={(event) => void update(task, { priority: event.target.value })}>
                  {["urgent", "high", "normal", "low"].map((value) => <option key={value} value={value}>{label(value)}</option>)}
                </select></td>
                <td>{dateLabel(task.due_at)}</td>
                <td><select className="re-inline-select" disabled={busyId === task.id} value={task.assigned_agent_id ?? ""} onChange={(event) => void update(task, { assignedAgentId: event.target.value || null })}>
                  <option value="">Unassigned</option>
                  {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                </select></td>
                <td><select className="re-inline-select" disabled={busyId === task.id} value={task.status} onChange={(event) => void update(task, { status: event.target.value })}>
                  {["open", "in_progress", "completed", "cancelled"].map((value) => <option key={value} value={value}>{label(value)}</option>)}
                </select></td>
              </tr>)}
              {!loading && tasks.length === 0 && <tr><td colSpan={5} className="re-empty">No back-office tasks yet. A task is created when the lead qualification pipeline completes.</td></tr>}
            </tbody>
          </table></div>
        </section>
      </div>
    </section>
  </main>;
}
