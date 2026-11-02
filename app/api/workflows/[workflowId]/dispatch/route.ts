import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { validateDefinition } from "@/lib/workflows/validate-definition.cjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("QUEUE_DATABASE_NOT_CONFIGURED");
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export async function POST(request: NextRequest, context: { params: Promise<{ workflowId: string }> }) {
  try {
    const { workflowId } = await context.params;
    if (!uuidPattern.test(workflowId)) return NextResponse.json({ error: "Invalid workflow ID." }, { status: 400 });
    const idempotencyKey = request.headers.get("idempotency-key") ?? "";
    if (!uuidPattern.test(idempotencyKey)) return NextResponse.json({ error: "A UUID Idempotency-Key header is required." }, { status: 400 });

    const userDb = await createClient();
    const { data: { user }, error: authError } = await userDb.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

    let body: unknown;
    try { body = await request.json(); } catch {
      return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Request must be a JSON object." }, { status: 400 });
    const input = (body as Record<string, unknown>).input ?? {};
    if (!input || typeof input !== "object" || Array.isArray(input) || Buffer.byteLength(JSON.stringify(input), "utf8") > 10240) {
      return NextResponse.json({ error: "Input must be a JSON object no larger than 10 KB." }, { status: 400 });
    }

    const { data: workflow, error: workflowError } = await userDb.from("workflows")
      .select("id, workspace_id, version, definition, status")
      .eq("id", workflowId).maybeSingle();
    if (workflowError) throw workflowError;
    if (!workflow) return NextResponse.json({ error: "Workflow not found or access denied." }, { status: 404 });
    if (workflow.status !== "active") return NextResponse.json({ error: "Only active workflows can be dispatched." }, { status: 409 });
    const validated = validateDefinition(workflow.definition);
    if (!validated.definition) return NextResponse.json({ error: "Workflow definition is invalid." }, { status: 422 });

    const db = serviceClient();
    const { data, error } = await db.rpc("dispatch_workflow_execution", {
      p_workspace_id: workflow.workspace_id,
      p_workflow_id: workflow.id,
      p_workflow_version: workflow.version,
      p_created_by: user.id,
      p_idempotency_key: idempotencyKey,
      p_payload: { input },
      p_max_attempts: 5,
    });
    if (error || !data || typeof data !== "object") throw error ?? new Error("DISPATCH_RESULT_INVALID");
    const result = data as { job_id: string; run_id: string; duplicate: boolean };
    return NextResponse.json({
      jobId: result.job_id, runId: result.run_id,
      status: result.duplicate ? "existing" : "queued",
      duplicate: result.duplicate,
    }, { status: result.duplicate ? 200 : 202 });
  } catch (error) {
    console.error("Aivanta workflow dispatch failed.", {
      errorCode: error instanceof Error && /^[A-Z0-9_]{1,64}$/.test(error.message) ? error.message : "DISPATCH_FAILED",
    });
    return NextResponse.json({ error: "Could not dispatch this workflow." }, { status: 500 });
  }
}
