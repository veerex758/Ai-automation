import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validateDefinition } from "@/lib/workflows/validate-definition.cjs";
import { runDryRun } from "@/lib/workflows/dry-run.cjs";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const maxInputBytes = 10 * 1024;

export async function POST(request: NextRequest, context: { params: Promise<{ workflowId: string }> }) {
  const startedAt = Date.now();
  try {
    const { workflowId } = await context.params;
    if (!uuidPattern.test(workflowId)) return NextResponse.json({ error: "Invalid workflow ID." }, { status: 400 });

    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (contentLength > maxInputBytes) {
      return NextResponse.json({ error: "Dry-run input must be 10 KB or smaller." }, { status: 413 });
    }

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

    let body: unknown;
    try { body = await request.json(); } catch {
      return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Request body must be an object." }, { status: 400 });
    }
    const requestBody = body as Record<string, unknown>;
    if (requestBody.mode !== undefined && requestBody.mode !== "dry_run") {
      return NextResponse.json({ error: "Only dry-run mode is available; live execution is not enabled." }, { status: 400 });
    }
    const input = requestBody.input === undefined ? {} : requestBody.input;
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return NextResponse.json({ error: "Dry-run input must be a JSON object." }, { status: 400 });
    }
    if (Buffer.byteLength(JSON.stringify(input), "utf8") > maxInputBytes) {
      return NextResponse.json({ error: "Dry-run input must be 10 KB or smaller." }, { status: 413 });
    }

    const { data: workflow, error: workflowError } = await supabase
      .from("workflows")
      .select("id, workspace_id, version, definition, status")
      .eq("id", workflowId)
      .maybeSingle();
    if (workflowError) throw workflowError;
    if (!workflow) return NextResponse.json({ error: "Workflow not found or you do not have access to it." }, { status: 404 });
    if (workflow.status === "archived") {
      return NextResponse.json({ error: "Archived workflows cannot be run." }, { status: 409 });
    }

    const validated = validateDefinition(workflow.definition);
    if (!validated.definition) {
      return NextResponse.json({ error: "This workflow definition is invalid. Save a valid definition before testing." }, { status: 422 });
    }

    const result = runDryRun(validated.definition, input as Record<string, unknown>);
    const durationMs = Math.max(0, Date.now() - startedAt);
    const { data, error: runError } = await supabase.rpc("record_workflow_dry_run", {
      p_workflow_id: workflow.id,
      p_expected_version: workflow.version,
      p_status: result.status,
      p_duration_ms: durationMs,
      p_error_message: null,
      p_steps: result.steps.map((step) => ({
        step_id: step.stepId,
        step_type: step.type,
        title: step.title,
        status: step.status,
        result: {
          message: step.message,
          ...(step.conditionMatched === undefined ? {} : { conditionMatched: step.conditionMatched }),
        },
      })),
    });
    if (runError) {
      if (runError.code === "P0002") return NextResponse.json({ error: "Workflow not found or you do not have access to it." }, { status: 404 });
      if (runError.code === "40001") return NextResponse.json({ error: "This workflow changed during the test. Reload it and try again." }, { status: 409 });
      if (runError.code === "22023") return NextResponse.json({ error: "This workflow could not be recorded safely." }, { status: 422 });
      throw runError;
    }
    const saved = Array.isArray(data) ? data[0] : data;
    if (!saved) throw new Error("The dry-run was not recorded.");

    return NextResponse.json({
      run: {
        id: saved.run_id,
        mode: "dry_run",
        status: result.status,
        workflow_version: saved.workflow_version,
        duration_ms: durationMs,
      },
      result,
      persisted: true,
      sideEffectsPerformed: false,
    }, { status: 201 });
  } catch (error) {
    console.error("Failed to run Aivanta workflow dry-run:", error);
    return NextResponse.json({ error: "Could not complete this workflow dry-run. Try again." }, { status: 500 });
  }
}

export async function GET(_request: NextRequest, context: { params: Promise<{ workflowId: string }> }) {
  try {
    const { workflowId } = await context.params;
    if (!uuidPattern.test(workflowId)) return NextResponse.json({ error: "Invalid workflow ID." }, { status: 400 });

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

    const { data: workflow, error: workflowError } = await supabase
      .from("workflows")
      .select("id, workspace_id")
      .eq("id", workflowId)
      .maybeSingle();
    if (workflowError) throw workflowError;
    if (!workflow) return NextResponse.json({ error: "Workflow not found or you do not have access to it." }, { status: 404 });

    const { data: runs, error: runsError } = await supabase
      .from("workflow_runs")
      .select("id, mode, status, workflow_version, started_at, completed_at, duration_ms, created_at")
      .eq("workflow_id", workflowId)
      .eq("workspace_id", workflow.workspace_id)
      .order("created_at", { ascending: false })
      .limit(25);
    if (runsError) throw runsError;

    const runIds = (runs ?? []).map((run) => run.id);
    if (runIds.length === 0) return NextResponse.json({ runs: [] });

    const { data: steps, error: stepsError } = await supabase
      .from("workflow_run_steps")
      .select("id, run_id, step_id, position, step_type, title, status, result, started_at, completed_at")
      .in("run_id", runIds)
      .order("position", { ascending: true });
    if (stepsError) throw stepsError;

    return NextResponse.json({
      runs: (runs ?? []).map((run) => ({
        ...run,
        steps: (steps ?? []).filter((step) => step.run_id === run.id),
      })),
    });
  } catch (error) {
    console.error("Failed to load Aivanta workflow run history:", error);
    return NextResponse.json({ error: "Could not load workflow run history. Try again." }, { status: 500 });
  }
}
