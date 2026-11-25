import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
import { hasWorkspacePermission } from "@/lib/supabase/permissions";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers });
    const workspace = await getOrCreateDefaultWorkspace(supabase);
    if (!(await hasWorkspacePermission(supabase, workspace.id, user.id, "operations.view"))) {
      return NextResponse.json({ error: "Workspace operations.view permission required." }, { status: 403, headers });
    }
    const { data: tasks, error } = await supabase.from("real_estate_tasks")
      .select("id,lead_id,assigned_agent_id,task_type,title,description,status,priority,due_at,created_at,completed_at")
      .eq("workspace_id", workspace.id).order("due_at", { ascending: true }).limit(200);
    if (error) throw error;
    const leadIds = [...new Set((tasks ?? []).map((task) => task.lead_id))];
    const { data: leads, error: leadError } = leadIds.length
      ? await supabase.from("real_estate_leads").select("id,full_name,email,phone,lead_score,lead_temperature").eq("workspace_id", workspace.id).in("id", leadIds)
      : { data: [], error: null };
    if (leadError) throw leadError;
    const leadMap = new Map((leads ?? []).map((lead) => [lead.id, lead]));
    return NextResponse.json({ tasks: (tasks ?? []).map((task) => ({ ...task, lead: leadMap.get(task.lead_id) ?? null })) }, { headers });
  } catch (error) {
    console.error("Real-estate task list failed", error);
    return NextResponse.json({ error: "Could not load back-office tasks." }, { status: 500, headers });
  }
}
