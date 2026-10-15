import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
import { logOperationalEvent } from "@/lib/observability/safe-log.cjs";

const limit = 50;

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "private, no-store, max-age=0" } });
    }

    const workspace = await getOrCreateDefaultWorkspace(supabase, user);
    const { data: runs, error: runsError } = await supabase
      .from("workflow_runs")
      .select("id, workflow_id, mode, status, workflow_version, created_at, duration_ms")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (runsError) throw runsError;
    const rows = runs ?? [];
    const workflowIds = [...new Set(rows.map((run) => run.workflow_id))];
    const names = new Map<string, string>();

    if (workflowIds.length) {
      const { data: workflows, error: workflowsError } = await supabase
        .from("workflows")
        .select("id, name")
        .eq("workspace_id", workspace.id)
        .in("id", workflowIds);
      if (workflowsError) throw workflowsError;
      for (const workflow of workflows ?? []) names.set(workflow.id, workflow.name);
    }

    return NextResponse.json({
      runs: rows.map((run) => ({
        id: run.id,
        workflowId: run.workflow_id,
        workflowName: names.get(run.workflow_id) ?? "Deleted workflow",
        mode: run.mode,
        status: run.status,
        workflowVersion: run.workflow_version,
        createdAt: run.created_at,
        durationMs: run.duration_ms,
      })),
      workspace: { id: workspace.id, name: workspace.name },
      limit,
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch {
    logOperationalEvent({
      event: "activity_list",
      route: "/api/activity",
      outcome: "failure",
      statusCode: 500,
      errorCode: "ACTIVITY_LIST_FAILED",
    });
    return NextResponse.json({ error: "Could not load activity. Please try again." }, { status: 500, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  }
}
