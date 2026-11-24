import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
import { hasWorkspacePermission } from "@/lib/supabase/permissions";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const validStatuses = ["open", "in_progress", "completed", "cancelled"];
const validPriorities = ["urgent", "high", "normal", "low"];

async function authWorkspace(permission: "workflows.view" | "workflows.execute") {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { response: NextResponse.json({ error: "Authentication required." }, { status: 401, headers }) };
  const workspace = await getOrCreateDefaultWorkspace(supabase);
  if (!await hasWorkspacePermission(supabase, workspace.id, user.id, permission)) {
    return { response: NextResponse.json({ error: "Workspace permission required." }, { status: 403, headers }) };
  }
  return { supabase, user, workspace };
}

export async function GET() {
  try {
    const auth = await authWorkspace("workflows.view");
    if ("response" in auth) return auth.response;
    const { data: tasks, error } = await auth.supabase.from("real_estate_tasks")
      .select("id,lead_id,assigned_agent_id,task_type,title,description,status,priority,due_at,idempotency_key,completed_at,created_at,updated_at")
      .eq("workspace_id", auth.workspace.id)
      .order("status", { ascending: true })
      .order("due_at", { ascending: true })
      .limit(200);
    if (error) throw error;
    const rows = tasks ?? [];
    const leadIds = [...new Set(rows.map((task) => task.lead_id))];
    const agentIds = [...new Set(rows.map((task) => task.assigned_agent_id).filter((id): id is string => typeof id === "string"))];
    const [leadResult, agentResult] = await Promise.all([
      leadIds.length
        ? auth.supabase.from("real_estate_leads").select("id,full_name,email,lead_score,lead_temperature").eq("workspace_id", auth.workspace.id).in("id", leadIds)
        : Promise.resolve({ data: [], error: null }),
      agentIds.length
        ? auth.supabase.from("agents").select("id,name").eq("workspace_id", auth.workspace.id).in("id", agentIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (leadResult.error || agentResult.error) throw leadResult.error ?? agentResult.error;
    const leads = new Map((leadResult.data ?? []).map((item) => [item.id, item]));
    const agents = new Map((agentResult.data ?? []).map((item) => [item.id, item]));
    return NextResponse.json({
      tasks: rows.map((task) => ({
        ...task,
        lead: leads.get(task.lead_id) ?? null,
        agent: task.assigned_agent_id ? agents.get(task.assigned_agent_id) ?? null : null,
      })),
    }, { headers });
  } catch (error) {
    console.error("Real-estate task list failed", error);
    return NextResponse.json({ error: "Could not load back-office tasks." }, { status: 503, headers });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await authWorkspace("workflows.execute");
    if ("response" in auth) return auth.response;
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > 3000) return NextResponse.json({ error: "Task update exceeds 3 KiB." }, { status: 413, headers });
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400, headers }); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Task update must be an object." }, { status: 400, headers });
    const input = body as Record<string, unknown>;
    if (typeof input.taskId !== "string" || !uuid.test(input.taskId)) return NextResponse.json({ error: "Invalid task ID." }, { status: 400, headers });

    const { data: existing, error: lookupError } = await auth.supabase.from("real_estate_tasks")
      .select("id,lead_id,assigned_agent_id,status").eq("id", input.taskId).eq("workspace_id", auth.workspace.id).maybeSingle();
    if (lookupError) throw lookupError;
    if (!existing) return NextResponse.json({ error: "Task not found in this workspace." }, { status: 404, headers });

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if ("status" in input) {
      if (typeof input.status !== "string" || !validStatuses.includes(input.status)) {
        return NextResponse.json({ error: "Choose a valid task status." }, { status: 400, headers });
      }
      update.status = input.status;
      update.completed_at = input.status === "completed" ? new Date().toISOString() : null;
    }
    if ("priority" in input) {
      if (typeof input.priority !== "string" || !validPriorities.includes(input.priority)) {
        return NextResponse.json({ error: "Choose a valid task priority." }, { status: 400, headers });
      }
      update.priority = input.priority;
    }
    if ("dueAt" in input) {
      if (typeof input.dueAt !== "string" || !Number.isFinite(Date.parse(input.dueAt))) {
        return NextResponse.json({ error: "Enter a valid due date." }, { status: 400, headers });
      }
      update.due_at = new Date(input.dueAt).toISOString();
    }
    if ("assignedAgentId" in input) {
      const value = input.assignedAgentId;
      if (value !== null && (typeof value !== "string" || !uuid.test(value))) {
        return NextResponse.json({ error: "Invalid assigned agent." }, { status: 400, headers });
      }
      if (typeof value === "string") {
        const { data: agent, error } = await auth.supabase.from("agents").select("id")
          .eq("id", value).eq("workspace_id", auth.workspace.id).eq("status", "active").maybeSingle();
        if (error) throw error;
        if (!agent) return NextResponse.json({ error: "The selected agent is not active in this workspace." }, { status: 403, headers });
      }
      update.assigned_agent_id = value;
    }
    const { data: saved, error: saveError } = await auth.supabase.from("real_estate_tasks")
      .update(update).eq("id", existing.id).eq("workspace_id", auth.workspace.id)
      .select("id,lead_id,assigned_agent_id,status,priority,due_at,completed_at").single();
    if (saveError) throw saveError;
    const { error: activityError } = await auth.supabase.from("real_estate_lead_activities").insert({
      workspace_id: auth.workspace.id,
      lead_id: existing.lead_id,
      actor_user_id: auth.user.id,
      activity_type: "lead.back_office_task_updated",
      details: { taskId: saved.id, updatedFields: Object.keys(update), status: saved.status },
    });
    if (activityError) throw activityError;
    return NextResponse.json({ task: saved }, { headers });
  } catch (error) {
    console.error("Real-estate task update failed", error);
    return NextResponse.json({ error: "Could not update this back-office task." }, { status: 500, headers });
  }
}
