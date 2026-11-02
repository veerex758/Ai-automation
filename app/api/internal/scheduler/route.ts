import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { validateDefinition } from "@/lib/workflows/validate-definition.cjs";


export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const claimLimit = 10;
const leaseSeconds = 300;

type ScheduleClaim = {
  schedule_id: string;
  workflow_id: string;
  workspace_id: string;
  interval_minutes: number;
  scheduled_for: string;
  lease_token: string;
  workflow_version: number;
  definition: unknown;
};

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET ?? process.env.AIVANTA_SCHEDULER_SECRET;
  if (!secret) return false;

  const authorization = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(authorization);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

function createSchedulerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SCHEDULER_DATABASE_NOT_CONFIGURED");

  return createSupabaseClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

async function finishClaim(
  supabase: ReturnType<typeof createSchedulerClient>,
  claim: ScheduleClaim,
  succeeded: boolean,
  errorCode: string | null,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("finish_workflow_schedule_claim", {
    p_schedule_id: claim.schedule_id,
    p_lease_token: claim.lease_token,
    p_succeeded: succeeded,
    p_error_code: errorCode,
  });
  if (error) return false;
  return data === true;
}

async function dispatchTick(request: NextRequest) {
  if (!isAuthorized(request)) {
    const secret = process.env.CRON_SECRET ?? process.env.AIVANTA_SCHEDULER_SECRET;
    return NextResponse.json(
      { error: secret ? "Unauthorized." : "Scheduler authentication is not configured." },
      { status: secret ? 401 : 503 },
    );
  }

  let supabase: ReturnType<typeof createSchedulerClient>;
  try {
    supabase = createSchedulerClient();
  } catch {
    return NextResponse.json({ error: "Scheduler database access is not configured." }, { status: 503 });
  }

  const { data, error } = await supabase.rpc("claim_due_workflow_schedules", {
    p_limit: claimLimit,
    p_lease_seconds: leaseSeconds,
  });
  if (error || !Array.isArray(data)) {
    console.error("Aivanta scheduler could not claim due schedules.");
    return NextResponse.json({ error: "Could not claim scheduled workflows." }, { status: 500 });
  }

  const claims = data as ScheduleClaim[];
  let queued = 0;
  let failed = 0;

  for (const claim of claims) {
    let failureCode = "SCHEDULED_RUN_FAILED";
    try {
      const validated = validateDefinition(claim.definition);
      if (!validated.definition) {
        failureCode = "INVALID_WORKFLOW_DEFINITION";
        throw new Error(failureCode);
      }
      if (
        validated.definition.nodes[0]?.type !== "trigger" ||
        validated.definition.nodes[0]?.settings.event !== "schedule"
      ) {
        failureCode = "INVALID_WORKFLOW_DEFINITION";
        throw new Error(failureCode);
      }

      // Atomically enqueue the immutable active workflow snapshot. The worker
      // performs a side-effect-free dry-run and owns retries/dead-letter handling.
      const scheduledFor = new Date(claim.scheduled_for).toISOString();
      const idempotencyKey = "schedule:" + claim.schedule_id + ":" + scheduledFor;
      const { data: dispatch, error: dispatchError } = await supabase.rpc("dispatch_workflow_execution", {
        p_workspace_id: claim.workspace_id,
        p_workflow_id: claim.workflow_id,
        p_workflow_version: claim.workflow_version,
        p_created_by: null,
        p_idempotency_key: idempotencyKey,
        p_payload: { input: {}, source: "schedule", scheduleId: claim.schedule_id, scheduledFor },
        p_max_attempts: 5,
      });
      if (dispatchError || !dispatch || typeof dispatch !== "object" ||
          typeof (dispatch as Record<string, unknown>).job_id !== "string" ||
          typeof (dispatch as Record<string, unknown>).run_id !== "string") {
        failureCode = "SCHEDULED_QUEUE_DISPATCH_FAILED";
        throw new Error(failureCode);
      }


      const finalized = await finishClaim(supabase, claim, true, null);
      if (!finalized) {
        // The durable run record is idempotent. If this lease expired, a later
        // worker can safely observe the existing record and finish the schedule.
        failed += 1;
        continue;
      }
      queued += 1;
    } catch {
      try {
        await finishClaim(supabase, claim, false, failureCode);
      } catch {
        // The lease expires and can be retried if the database is temporarily unavailable.
      }
      failed += 1;
      console.error("Aivanta scheduled workflow failed.", {
        scheduleId: claim.schedule_id,
        errorCode: failureCode,
      });
    }
  }

  return NextResponse.json({ claimed: claims.length, queued, failed });
}

export async function GET(request: NextRequest) {
  return dispatchTick(request);
}

export async function POST(request: NextRequest) {
  return dispatchTick(request);
}
