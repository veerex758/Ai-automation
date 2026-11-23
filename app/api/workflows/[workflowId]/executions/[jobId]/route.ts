import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getAdminSupabaseConfig } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { hasWorkspacePermission } from "@/lib/supabase/permissions";

export const runtime = "nodejs";
function privateJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function serviceClient() {
  let config: ReturnType<typeof getAdminSupabaseConfig>;
  try { config = getAdminSupabaseConfig(); }
  catch { throw new Error("EXECUTION_DATABASE_NOT_CONFIGURED"); }
  return createSupabaseClient(config.url, config.serviceRoleKey, {
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
      return privateJson({ error: "Invalid execution identifier." }, { status: 400 });
    }

    const userDb = await createClient();
    const { data: { user }, error: authError } = await userDb.auth.getUser();
    if (authError || !user) return privateJson({ error: "Authentication required." }, { status: 401, headers });

    // Resolve workspace through the user's RLS-scoped workflow read before
    // using the server client. Never accept workspace IDs from the caller.
    const { data: workflow, error: workflowError } = await userDb.from("workflows")
      .select("id, workspace_id").eq("id", workflowId).maybeSingle();
    if (workflowError) throw workflowError;
    if (!workflow) return privateJson({ error: "Workflow not found or access denied." }, { status: 404 });
    if (!(await hasWorkspacePermission(userDb, workflow.workspace_id, user.id, "workflows.view"))) return privateJson({ error: "Workspace workflows.view permission required." }, { status: 403, headers });

    const db = serviceClient();
    const { data: job, error: jobError } = await db.from("execution_jobs")
      .select("id, run_id, status, attempts, max_attempts, available_at, started_at, completed_at, last_error_code, cancel_requested_at, created_at")
      .eq("id", jobId).eq("workflow_id", workflow.id).eq("workspace_id", workflow.workspace_id).maybeSingle();
    if (jobError) throw jobError;
    if (!job) return privateJson({ error: "Execution not found." }, { status: 404 });

    const { data: checkpoints, error: checkpointError } = await db.from("execution_checkpoints")
      .select("step_id, step_position, status, attempt, started_at, completed_at, output")
      .eq("job_id", job.id).eq("workspace_id", workflow.workspace_id)
      .order("step_position", { ascending: true });
    if (checkpointError) throw checkpointError;

    return privateJson({ job, checkpoints: checkpoints ?? [] });
  } catch (error) {
    console.error("Aivanta execution status lookup failed.", {
      errorCode: error instanceof Error && /^[A-Z0-9_]{1,64}$/.test(error.message) ? error.message : "EXECUTION_STATUS_FAILED",
    });
    return privateJson({ error: "Could not load execution status." }, { status: 500 });
  }
}


export async function PATCH(
  _request: NextRequest,
  context: { params: Promise<{ workflowId: string; jobId: string }> },
) {
  try {
    const { workflowId, jobId } = await context.params;
    if (!uuidPattern.test(workflowId) || !uuidPattern.test(jobId)) {
      return privateJson({ error: "Invalid execution identifier." }, { status: 400 });
    }
    const userDb = await createClient();
    const { data: { user }, error: authError } = await userDb.auth.getUser();
    if (authError || !user) return privateJson({ error: "Authentication required." }, { status: 401 });
    const { data: workflow, error: workflowError } = await userDb.from("workflows")
      .select("id,workspace_id").eq("id", workflowId).maybeSingle();
    if (workflowError) throw workflowError;
    if (!workflow) return privateJson({ error: "Workflow not found or access denied." }, { status: 404 });
    if (!(await hasWorkspacePermission(userDb, workflow.workspace_id, user.id, "workflows.execute"))) return privateJson({ error: "Workspace workflows.execute permission required." }, { status: 403, headers });

    const db = serviceClient();
    const { data, error } = await db.rpc("cancel_execution_job", {
      p_job_id: jobId, p_workspace_id: workflow.workspace_id, p_workflow_id: workflow.id,
    });
    if (error) throw error;
    if (data === "not_found") return privateJson({ error: "Execution not found." }, { status: 404 });
    if (data === "not_cancellable") return privateJson({ error: "This execution has already finished and cannot be cancelled." }, { status: 409 });
    return privateJson({
      status: data,
      message: data === "cancelled"
        ? "Queued execution cancelled."
        : "Cancellation requested. The worker will stop before its next operation.",
    }, { status: data === "cancelled" ? 200 : 202 });
  } catch (error) {
    console.error("Aivanta execution cancellation failed.", {
      errorCode: error instanceof Error && /^[A-Z0-9_]{1,64}$/.test(error.message) ? error.message : "EXECUTION_CANCEL_FAILED",
    });
    return privateJson({ error: "Could not cancel this execution." }, { status: 500 });
  }
}
