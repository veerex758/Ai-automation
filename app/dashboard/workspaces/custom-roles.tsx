"use client";
import { useCallback, useEffect, useState } from "react";
type Member = { user_id: string; email: string | null; role: string; custom_role_id: string | null };
type Role = { id: string; name: string; description: string; permissions: Record<string, boolean> };
const LABELS: Record<string, string> = {
  "workflows.view": "View workflows", "workflows.create": "Create workflows", "workflows.edit": "Edit workflows", "workflows.delete": "Delete workflows", "workflows.execute": "Execute workflows",
  "integrations.view": "View integrations", "integrations.manage": "Manage integrations", "dashboards.view": "View dashboards", "dashboards.manage": "Manage dashboards",
  "members.view": "View members", "members.manage": "Manage members", "billing.view": "View billing", "billing.manage": "Manage billing",
  "operations.view": "View operations", "operations.manage": "Manage alert settings", "settings.manage": "Manage workspace settings",
};
export default function CustomRoles({ workspaceId }: { workspaceId: string }) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [catalog, setCatalog] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});
  const [editingId, setEditingId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    const [r, m] = await Promise.all([
      fetch("/api/workspaces/" + workspaceId + "/roles", { cache: "no-store" }),
      fetch("/api/workspaces/" + workspaceId + "/members", { cache: "no-store" }),
    ]);
    const rd = await r.json(), md = await m.json();
    if (!r.ok) throw new Error(rd.error || "Could not load custom roles.");
    if (!m.ok) throw new Error(md.error || "Could not load workspace members.");
    setRoles(rd.roles ?? []); setCatalog(rd.permission_catalog ?? []); setMembers(md.members ?? []);
  }, [workspaceId]);
  useEffect(() => { void load().catch((e) => setError(e instanceof Error ? e.message : "Could not load roles.")); }, [load]);
  function reset() { setEditingId(""); setName(""); setDescription(""); setPermissions({}); }
  function edit(role: Role) { setEditingId(role.id); setName(role.name); setDescription(role.description); setPermissions(role.permissions ?? {}); }
  async function save() {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/workspaces/" + workspaceId + "/roles", {
        method: editingId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(editingId ? { id: editingId } : {}), name, description, permissions }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save custom role.");
      await load(); reset(); setNotice(editingId ? "Custom role updated." : "Custom role created.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save custom role."); }
    finally { setBusy(false); }
  }
  async function assign(userId: string, roleId: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/workspaces/" + workspaceId + "/roles/assign", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: userId, custom_role_id: roleId || null }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not assign custom role.");
      await load(); setNotice("Member permissions updated.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not assign custom role."); }
    finally { setBusy(false); }
  }
  async function remove(roleId: string) {
    if (!window.confirm("Delete this custom role?")) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/workspaces/" + workspaceId + "/roles?id=" + encodeURIComponent(roleId), { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not delete role.");
      await load(); setNotice("Custom role deleted.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not delete role."); }
    finally { setBusy(false); }
  }
  return <section className="workspace-admin-panel workspace-team-panel">
    <h2>Custom roles & permissions</h2>
    <p>Create workspace-specific roles with granular access. Owners and administrators retain full control; custom roles apply to regular members.</p>
    {error && <p className="workspace-error" role="alert">{error}</p>}
    {notice && <p className="workspace-notice" role="status">{notice}</p>}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))", gap: 18 }}>
      <div>
        <label>Role name<input value={name} onChange={(e) => setName(e.target.value)} maxLength={48} placeholder="e.g. Workflow operator" /></label>
        <label>Description<input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={240} placeholder="What can this role do?" /></label>
        <h3>Permissions</h3>
        <div style={{ display: "grid", gap: 7 }}>
          {catalog.map((key) => <label key={key} style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={permissions[key] === true} onChange={(e) => setPermissions({ ...permissions, [key]: e.target.checked })} />{LABELS[key] ?? key}</label>)}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}><button onClick={() => void save()} disabled={busy || name.trim().length < 2}>{editingId ? "Save role" : "Create role"}</button>{editingId && <button onClick={reset} disabled={busy}>Cancel</button>}</div>
      </div>
      <div>
        <h3>Existing roles</h3>
        {roles.length ? roles.map((role) => <article className="workspace-member" key={role.id}><div><strong>{role.name}</strong><small>{role.description || "Custom permission set"}</small></div><button onClick={() => edit(role)} disabled={busy}>Edit</button><button onClick={() => void remove(role.id)} disabled={busy}>Delete</button></article>) : <p>No custom roles created yet.</p>}
        <h3>Member assignments</h3>
        {members.filter((member) => member.role === "member").map((member) => <label key={member.user_id}>{member.email || member.user_id}<select value={member.custom_role_id ?? ""} disabled={busy} onChange={(e) => void assign(member.user_id, e.target.value)}><option value="">Default member permissions</option>{roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label>)}
      </div>
    </div>
  </section>;
}
