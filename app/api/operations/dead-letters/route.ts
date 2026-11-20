import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveDeadLetterOperator } from "@/lib/operations/dead-letter-access";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET() {
  try {
    const resolved = await resolveDeadLetterOperator();
    if (!resolved.ok) return resolved.response;

    const { workspace } = resolved.context;
    const admin = createAdminClient();
    const { data: deadLetters, error: deadError } = await admin.from("execution_dead_letters")
      .select("id,original_job_id,workflow_id,run_id,attempts,error_code,failed_at")
      .eq("workspace_id", workspace.id)
      .order("failed_at", { ascending: false })
      .limit(50);
    if (deadError) throw deadError;

    const rows = deadLetters ?? [];
    const originalIds = rows.map((row) => row.original_job_id);
    const workflowIds = [...new Set(rows.map((row) => row.workflow_id))];
    const deadIds = rows.map((row) => row.id);
    const [originalJobs, workflows, recoveries] = await Promise.all([
      originalIds.length
        ? admin.from("execution_jobs").select("id,status,execution_mode,workflow_version").eq("workspace_id", workspace.id).in("id", originalIds)
        : Promise.resolve({ data: [], error: null }),
      workflowIds.length
        ? admin.from("workflows").select("id,name").eq("workspace_id", workspace.id).in("id", workflowIds)
        : Promise.resolve({ data: [], error: null }),
      deadIds.length
        ? admin.from("execution_dead_letter_recoveries")
            .select("id,dead_letter_id,recovery_job_id,recovery_run_id,recovery_mode,requested_at")
            .eq("workspace_id", workspace.id).in("dead_letter_id", deadIds)
            .order("requested_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ]);
    const queryError = originalJobs.error || workflows.error || recoveries.error;
    if (queryError) throw queryError;

    const recoveryJobIds = (recoveries.data ?? []).map((item) => item.recovery_job_id);
    const recoveryJobs = recoveryJobIds.length
      ? await admin.from("execution_jobs").select("id,status").eq("workspace_id", workspace.id).in("id", recoveryJobIds)
      : { data: [], error: null };
    if (recoveryJobs.error) throw recoveryJobs.error;

    const jobById = new Map((originalJobs.data ?? []).map((job) => [job.id, job]));
    const workflowById = new Map((workflows.data ?? []).map((workflow) => [workflow.id, workflow]));
    const recoveryJobById = new Map((recoveryJobs.data ?? []).map((job) => [job.id, job]));
    const recoveriesByDeadLetter = new Map<string, Array<Record<string, unknown>>>();
    for (const item of recoveries.data ?? []) {
      const current = recoveriesByDeadLetter.get(item.dead_letter_id) ?? [];
      current.push({
        id: item.id,
        job_id: item.recovery_job_id,
        run_id: item.recovery_run_id,
        mode: item.recovery_mode,
        status: recoveryJobById.get(item.recovery_job_id)?.status ?? "unknown",
        requested_at: item.requested_at,
      });
      recoveriesByDeadLetter.set(item.dead_letter_id, current);
    }

    return NextResponse.json({
      generated_at: new Date().toISOString(),
      dead_letters: rows.map((row) => {
        const original = jobById.get(row.original_job_id);
        return {
          id: row.id,
          workflow_id: row.workflow_id,
          workflow_name: workflowById.get(row.workflow_id)?.name ?? "Deleted workflow",
          run_id: row.run_id,
          attempts: row.attempts,
          error_code: row.error_code,
          failed_at: row.failed_at,
          execution_mode: original?.execution_mode ?? "unknown",
          workflow_version: original?.workflow_version ?? null,
          status: original?.status ?? "unknown",
          recoveries: recoveriesByDeadLetter.get(row.id) ?? [],
        };
      }),
    }, { headers });
  } catch (error) {
    console.error("Dead-letter list failed.", {
      errorCode: error instanceof Error && /^[A-Z0-9_]{1,64}$/.test(error.message) ? error.message : "DEAD_LETTER_LIST_FAILED",
    });
    return NextResponse.json({ error: "Dead-letter history is temporarily unavailable." }, { status: 503, headers });
  }
}
