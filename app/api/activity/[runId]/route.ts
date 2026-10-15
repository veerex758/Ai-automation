import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
import { logOperationalEvent } from "@/lib/observability/safe-log.cjs";

type RouteContext = { params: Promise<{ runId: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    const headers = { "Cache-Control": "private, no-store, max-age=0" };
    if (authError || !user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401, headers });
    }

    const { runId } = await context.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId)) {
      return NextResponse.json({ error: "Invalid run identifier." }, { status: 400, headers });
    }

    const workspace = await getOrCreateDefaultWorkspace(supabase, user);
    const { data: run, error: runError } = await supabase
      .from("workflow_runs")
      .select("id, workflow_id, mode, status, workflow_version, started_at, completed_at, created_at, duration_ms")
      .eq("id", runId)
      .eq("workspace_id", workspace.id)
      .maybeSingle();

    if (runError) throw runError;
    if (!run) return NextResponse.json({ error: "Run not found." }, { status: 404, headers });

    const [{ data: workflow, error: workflowError }, { data: steps, error: stepsError }] = await Promise.all([
      supabase.from("workflows").select("id, name").eq("id", run.workflow_id).eq("workspace_id", workspace.id).maybeSingle(),
      supabase.from("workflow_run_steps")
        .select("id, step_id, position, step_type, title, status, started_at, completed_at")
        .eq("run_id", run.id)
        .eq("workspace_id", workspace.id)
        .order("position", { ascending: true }),
    ]);

    if (workflowError) throw workflowError;
    if (stepsError) throw stepsError;

    return NextResponse.json({
      run: {
        id: run.id,
        workflowId: run.workflow_id,
        workflowName: workflow?.name ?? "Deleted workflow",
        mode: run.mode,
        status: run.status,
        workflowVersion: run.workflow_version,
        startedAt: run.started_at,
        completedAt: run.completed_at,
        createdAt: run.created_at,
        durationMs: run.duration_ms,
      },
      steps: (steps ?? []).map((step) => ({
        id: step.id,
        stepId: step.step_id,
        position: step.position,
        type: step.step_type,
        title: step.title,
        status: step.status,
        startedAt: step.started_at,
        completedAt: step.completed_at,
      })),
    }, { headers });
  } catch {
    logOperationalEvent({
      event: "activity_run_detail",
      route: "/api/activity/run-detail",
      outcome: "failure",
      statusCode: 500,
      errorCode: "ACTIVITY_RUN_DETAIL_FAILED",
    });
    return NextResponse.json({ error: "Could not load run details. Please try again." }, { status: 500, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  }
}
