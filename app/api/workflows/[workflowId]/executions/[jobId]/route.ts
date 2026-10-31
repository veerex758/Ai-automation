import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("EXECUTION_DATABASE_NOT_CONFIGURED");
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ workflowId: string; jobId: string }> },
) {
  try {
    const { workflowId, jobId } = await context.params;
    if (!uuidPattern.test(workflowId) || !uuidPattern.test(jobId)) {
      return NextResponse.json({ error: "Invalid execution identifier." }, { status: 400 });
    }

    const userDb = await createClient();
    const { data: { user }, error: authError } = await userDb.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

    // Resolve workspace through the user's RLS-scoped workflow read before
    // using the server client. Never accept workspace IDs from the caller.
    const { data: workflow, error: workflowError } = await userDb.from("workflows")
      .select("id, workspace_id").eq("id", workflowId).maybeSingle();
    if (workflowError) throw workflowError;
    if (!workflow) return NextResponse.json({ error: "Workflow not found or access denied." }, { status: 404 });

    const db = serviceClient();
    const { data: job, error: jobError } = await db.from("execution_jobs")
      .select("id, run_id, status, attempts, max_attempts, available_at, started_at, completed_at, last_error_code, created_at")
      .eq("id", jobId).eq("workflow_id", workflow.id).eq("workspace_id", workflow.workspace_id).maybeSingle();
    if (jobError) throw jobError;
    if (!job) return NextResponse.json({ error: "Execution not found." }, { status: 404 });

    const { data: checkpoints, error: checkpointError } = await db.from("execution_checkpoints")
      .select("step_id, step_position, status, attempt, started_at, completed_at, output")
      .eq("job_id", job.id).eq("workspace_id", workflow.workspace_id)
      .order("step_position", { ascending: true });
    if (checkpointError) throw checkpointError;

    return NextResponse.json({ job, checkpoints: checkpoints ?? [] });
  } catch (error) {
    console.error("Aivanta execution status lookup failed.", {
      errorCode: error instanceof Error && /^[A-Z0-9_]{1,64}$/.test(error.message) ? error.message : "EXECUTION_STATUS_FAILED",
    });
    return NextResponse.json({ error: "Could not load execution status." }, { status: 500 });
  }
}
