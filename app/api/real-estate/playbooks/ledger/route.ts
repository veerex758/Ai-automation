import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
import { hasWorkspacePermission } from "@/lib/supabase/permissions";

export const dynamic = "force-dynamic";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers });
    const workspace = await getOrCreateDefaultWorkspace(supabase);
    if (!(await hasWorkspacePermission(supabase, workspace.id, user.id, "workflows.view"))) {
      return NextResponse.json({ error: "Workspace workflows.view permission required." }, { status: 403, headers });
    }
    const workflowId = request.nextUrl.searchParams.get("workflowId");
    if (!workflowId || !uuid.test(workflowId)) return NextResponse.json({ error: "A valid Playbook ID is required." }, { status: 400, headers });
    const { data: workflow, error: workflowError } = await supabase.from("workflows")
      .select("id").eq("id", workflowId).eq("workspace_id", workspace.id).maybeSingle();
    if (workflowError) throw workflowError;
    if (!workflow) return NextResponse.json({ error: "Playbook not found in this workspace." }, { status: 404, headers });

    const { data: leads, error: leadsError } = await supabase.from("real_estate_leads")
      .select("id,full_name,lead_score,status,qualification_status,agent_notification_status,pipeline_status")
      .eq("workspace_id", workspace.id).eq("workflow_id", workflowId)
      .order("created_at", { ascending: false }).limit(100);
    if (leadsError) throw leadsError;
    const leadIds = (leads ?? []).map((lead) => lead.id);
    if (!leadIds.length) return NextResponse.json({ events: [], leadCount: 0 }, { headers });

    const [activities, followups] = await Promise.all([
      supabase.from("real_estate_lead_activities")
        .select("id,lead_id,activity_type,details,created_at")
        .eq("workspace_id", workspace.id).in("lead_id", leadIds)
        .order("created_at", { ascending: false }).limit(300),
      supabase.from("real_estate_followups")
        .select("id,lead_id,sequence,status,due_at,sent_at,last_error_code,attempt_count")
        .eq("workspace_id", workspace.id).in("lead_id", leadIds)
        .order("created_at", { ascending: false }).limit(100),
    ]);
    if (activities.error || followups.error) throw activities.error ?? followups.error;

    const leadById = new Map((leads ?? []).map((lead) => [lead.id, lead]));
    const events = (activities.data ?? []).map((event) => ({
      id: event.id,
      leadId: event.lead_id,
      leadName: leadById.get(event.lead_id)?.full_name ?? "Enquiry",
      type: event.activity_type,
      details: event.details,
      createdAt: event.created_at,
    }));
    const delivery = (followups.data ?? []).map((item) => ({
      id: item.id,
      leadId: item.lead_id,
      leadName: leadById.get(item.lead_id)?.full_name ?? "Enquiry",
      sequence: item.sequence,
      status: item.status,
      dueAt: item.due_at,
      sentAt: item.sent_at,
      errorCode: item.last_error_code,
      attempts: item.attempt_count,
    }));
    return NextResponse.json({
      events,
      delivery,
      leadCount: leads?.length ?? 0,
      activityCount: events.length,
    }, { headers });
  } catch (error) {
    console.error("Playbook Outcome Ledger failed", error);
    return NextResponse.json({ error: "Could not load this Playbook's outcome history." }, { status: 500, headers });
  }
}
