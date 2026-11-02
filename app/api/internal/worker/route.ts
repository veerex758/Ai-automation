import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { validateDefinition } from "@/lib/workflows/validate-definition.cjs";
import { runDryRun } from "@/lib/workflows/dry-run.cjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Job = {
  id: string; workspace_id: string; workflow_id: string; run_id: string;
  workflow_version: number; workflow_definition: Record<string, unknown>;
  payload: Record<string, unknown>; attempts: number; lease_token: string;
};

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET ?? process.env.AIVANTA_WORKER_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("WORKER_DATABASE_NOT_CONFIGURED");
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function tick(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized or worker secret not configured." }, { status: 401 });
  let db: ReturnType<typeof client>;
  try { db = client(); } catch {
    return NextResponse.json({ error: "Worker database access is not configured." }, { status: 503 });
  }

  const workerId = process.env.AIVANTA_WORKER_ID?.slice(0, 100) || "vercel-worker";
  const { data, error } = await db.rpc("claim_execution_jobs", {
    p_worker_id: workerId, p_limit: 5, p_lease_seconds: 120,
  });
  if (error || !Array.isArray(data)) {
    console.error("Aivanta worker could not claim jobs.");
    return NextResponse.json({ error: "Could not claim execution jobs." }, { status: 500 });
  }

  let succeeded = 0, retried = 0, deadLettered = 0, leaseLost = 0;
  for (const job of data as Job[]) {
    let outcome = "EXECUTION_FAILED";
    try {
      // Execute the immutable definition captured atomically at dispatch time,
      // not the mutable current workflow row.
      const validated = validateDefinition(job.workflow_definition);
      if (!validated.definition) throw new Error("INVALID_WORKFLOW_DEFINITION");
      const input = job.payload && typeof job.payload.input === "object" && job.payload.input !== null
        ? job.payload.input as Record<string, unknown> : {};
      const result = runDryRun(validated.definition, input);
      if (result.sideEffectsPerformed !== false) throw new Error("UNSAFE_EXECUTOR_RESULT");

      for (const step of result.steps) {
        const { error: checkpointError } = await db.rpc("checkpoint_execution_step", {
          p_job_id: job.id, p_lease_token: job.lease_token,
          p_step_id: step.stepId, p_position: step.position,
          p_status: step.status === "skipped" ? "skipped" : "succeeded",
          p_input: {}, p_output: { message: step.message },
        });
        if (checkpointError) throw new Error("CHECKPOINT_WRITE_FAILED");
      }

      const stepRows = result.steps.map((step) => ({
        run_id: job.run_id, workspace_id: job.workspace_id, step_id: step.stepId,
        position: step.position, step_type: step.type, title: step.title,
        status: step.status, result: { message: step.message },
      }));
      const { error: stepsError } = await db.from("workflow_run_steps").upsert(stepRows, { onConflict: "run_id,step_id" });
      if (stepsError) throw new Error("RUN_STEP_PERSISTENCE_FAILED");

      const finalStatus = result.status === "succeeded";
      if (!finalStatus) throw new Error("WORKFLOW_STEP_FAILED");

      // The database validates the lease and finalizes the run atomically.
      const { data: finished, error: finishError } = await db.rpc("finish_execution_job", {
        p_job_id: job.id, p_lease_token: job.lease_token, p_succeeded: true, p_error_code: null,
      });
      if (finishError || finished !== "succeeded") { leaseLost++; continue; }
      succeeded++;
    } catch (error) {
      outcome = error instanceof Error && /^[A-Z0-9_]{1,64}$/.test(error.message) ? error.message : "EXECUTION_FAILED";
      const { data: finished, error: finishError } = await db.rpc("finish_execution_job", {
        p_job_id: job.id, p_lease_token: job.lease_token, p_succeeded: false, p_error_code: outcome,
      });
      if (finishError || finished === "lease_lost") leaseLost++;
      else if (finished === "dead_letter") deadLettered++;
      else if (finished === "retry_wait") retried++;
      console.error("Aivanta execution job failed.", { jobId: job.id, errorCode: outcome });
    }
  }
  return NextResponse.json({ claimed: data.length, succeeded, retried, deadLettered, leaseLost });
}

export async function POST(request: NextRequest) { return tick(request); }
export async function GET(request: NextRequest) { return tick(request); }
