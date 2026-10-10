import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validateDefinition } from "@/lib/workflows/validate-definition.cjs";
import { runDryRun } from "@/lib/workflows/execute-dry-run.cjs";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

export async function POST(request: NextRequest, context: { params: Promise<{ workflowId: string }> }) {
  try {
    const { workflowId } = await context.params;
    if (!uuidPattern.test(workflowId)) return NextResponse.json({ error: "Invalid workflow ID." }, { status: 400 });

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

    let body: unknown = {};
    try { body = await request.json(); } catch {
      return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
    }
    if (!isRecord(body)) return NextResponse.json({ error: "Test run body must be a JSON object." }, { status: 400 });
    const input = body.input === undefined ? {} : body.input;
    if (!isRecord(input)) return NextResponse.json({ error: "Test input must be a JSON object." }, { status: 400 });
    if (JSON.stringify(input).length > 20000) return NextResponse.json({ error: "Test input cannot exceed 20 KB." }, { status: 413 });

    const { data: workflow, error: workflowError } = await supabase.from("workflows")
      .select("id, workspace_id, version, definition").eq("id", workflowId).maybeSingle();
    if (workflowError) throw workflowError;
    if (!workflow) return NextResponse.json({ error: "Workflow not found or you do not have access to it." }, { status: 404 });

    const validated = validateDefinition(workflow.definition);
    if (!validated.definition) return NextResponse.json({ error: validated.error || "Save a valid workflow before testing it." }, { status: 422 });

    const execution = runDryRun(validated.definition, input);
    const { data, error } = await supabase.rpc("record_workflow_dry_run", {
      p_workflow_id: workflowId,
      p_expected_version: workflow.version,
      p_status: execution.status,
      p_duration_ms: execution.durationMs,
      p_error_message: null,
      p_steps: execution.steps.map((step) => ({
        step_id: step.step_id, step_type: step.step_type, title: step.title,
        status: step.status, result: step.result,
      })),
    });

    if (error) {
      if (error.code === "P0002") return NextResponse.json({ error: "Workflow not found or you do not have access to it." }, { status: 404 });
      if (error.code === "40001") return NextResponse.json({ error: "This workflow changed during the test. Reload it and try again." }, { status: 409 });
      if (error.code === "22023") return NextResponse.json({ error: error.message || "This workflow could not be tested." }, { status: 422 });
      throw error;
    }
    const saved = Array.isArray(data) ? data[0] : data;
    if (!saved) throw new Error("The test run was not recorded.");
    return NextResponse.json({
      run: { id: saved.run_id, version: saved.workflow_version, status: execution.status, mode: execution.mode, durationMs: execution.durationMs },
      steps: execution.steps,
    }, { status: 201 });
  } catch (error) {
    console.error("Failed to run Aivanta workflow dry-run:", error);
    return NextResponse.json({ error: "Could not test this workflow. Try again." }, { status: 500 });
  }
}
