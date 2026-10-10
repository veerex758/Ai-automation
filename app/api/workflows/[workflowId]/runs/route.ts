import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, context: { params: Promise<{ workflowId: string }> }) {
  try {
    const { workflowId } = await context.params;
    if (!uuidPattern.test(workflowId)) {
      return NextResponse.json({ error: "Invalid workflow ID." }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const { data: workflow, error: workflowError } = await supabase
      .from("workflows")
      .select("id")
      .eq("id", workflowId)
      .maybeSingle();
    if (workflowError) throw workflowError;
    if (!workflow) {
      return NextResponse.json({ error: "Workflow not found or you do not have access to it." }, { status: 404 });
    }

    const { data, error } = await supabase
      .from("workflow_runs")
      .select("id, workflow_version, mode, status, started_at, completed_at, duration_ms, error_message, created_at, workflow_run_steps(id, step_id, position, step_type, title, status, result)")
      .eq("workflow_id", workflowId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw error;

    return NextResponse.json({
      runs: (data ?? []).map((run) => ({
        ...run,
        steps: [...(run.workflow_run_steps ?? [])].sort((a, b) => a.position - b.position),
      })),
    });
  } catch (error) {
    console.error("Failed to load Aivanta workflow run history:", error);
    return NextResponse.json({ error: "Could not load workflow run history. Try again." }, { status: 500 });
  }
}
