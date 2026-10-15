import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { validateDefinition } from "@/lib/workflows/validate-definition.cjs";
import { runDryRun } from "@/lib/workflows/dry-run.cjs";
import { getRequestId, logOperationalEvent } from "@/lib/observability/safe-log.cjs";

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
  try {
    const { data, error } = await supabase.rpc("finish_workflow_schedule_claim", {
      p_schedule_id: claim.schedule_id,
      p_lease_token: claim.lease_token,
      p_succeeded: succeeded,
      p_error_code: errorCode,
    });
    if (error) return false;
    return data === true;
  } catch {
    // A transient transport failure must not escape the scheduler tick.
    // The lease expiry remains the recovery path for an unfinalized claim.
    return false;
  }
}

async function dispatchTick(request: NextRequest) {
  const requestId = getRequestId(request.headers.get("x-request-id"));
  const startedAt = Date.now();
  const jsonResponse = (body: unknown, status = 200) => {
    const response = NextResponse.json(body, { status });
    response.headers.set("x-request-id", requestId);
    response.headers.set("Cache-Control", "no-store");
    return response;
  };

  if (!isAuthorized(request)) {
    const secret = process.env.CRON_SECRET ?? process.env.AIVANTA_SCHEDULER_SECRET;
    logOperationalEvent({
      event: "scheduler_tick",
      requestId,
      route: "/api/internal/scheduler",
      outcome: "rejected",
      statusCode: secret ? 401 : 503,
      errorCode: secret ? "SCHEDULER_UNAUTHORIZED" : "SCHEDULER_AUTH_NOT_CONFIGURED",
      durationMs: Math.max(0, Date.now() - startedAt),
    }, console.warn);
    return jsonResponse(
      { error: secret ? "Unauthorized." : "Scheduler authentication is not configured." },
      secret ? 401 : 503,
    );
  }

  let supabase: ReturnType<typeof createSchedulerClient>;
  try {
    supabase = createSchedulerClient();
  } catch {
    logOperationalEvent({
      event: "scheduler_tick",
      requestId,
      route: "/api/internal/scheduler",
      outcome: "failure",
      statusCode: 503,
      errorCode: "SCHEDULER_DATABASE_NOT_CONFIGURED",
      durationMs: Math.max(0, Date.now() - startedAt),
    }, console.error);
    return jsonResponse({ error: "Scheduler database access is not configured." }, 503);
  }

  let claimData: unknown;
  let claimFailed = false;
  try {
    const { data, error } = await supabase.rpc("claim_due_workflow_schedules", {
      p_limit: claimLimit,
      p_lease_seconds: leaseSeconds,
    });
    claimData = data;
    claimFailed = Boolean(error);
  } catch {
    // Network/client exceptions are handled the same way as returned RPC errors.
    claimFailed = true;
  }

  if (claimFailed || !Array.isArray(claimData)) {
    logOperationalEvent({
      event: "scheduler_tick",
      requestId,
      route: "/api/internal/scheduler",
      outcome: "failure",
      statusCode: 500,
      errorCode: "SCHEDULER_CLAIM_FAILED",
      durationMs: Math.max(0, Date.now() - startedAt),
    }, console.error);
    return jsonResponse({ error: "Could not claim scheduled workflows." }, 500);
  }

  const claims = claimData as ScheduleClaim[];
  let succeeded = 0;
  let failed = 0;

  for (const claim of claims) {
    const workflowStartedAt = Date.now();
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

      const runStartedAt = Date.now();
      const result = runDryRun(validated.definition, {});
      const durationMs = Math.min(600000, Math.max(0, Date.now() - runStartedAt));
      if (result.status !== "succeeded" || result.sideEffectsPerformed !== false) {
        throw new Error("SCHEDULED_RUN_FAILED");
      }

      let persistError: unknown = null;
      try {
        const result = await supabase.rpc("record_scheduled_workflow_run", {
          p_schedule_id: claim.schedule_id,
          p_lease_token: claim.lease_token,
          p_expected_version: claim.workflow_version,
          p_duration_ms: durationMs,
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
        persistError = result.error;
      } catch {
        // Keep thrown transport exceptions classified consistently with RPC errors.
        failureCode = "SCHEDULED_RUN_PERSISTENCE_FAILED";
        throw new Error(failureCode);
      }
      if (persistError) {
        failureCode = "SCHEDULED_RUN_PERSISTENCE_FAILED";
        throw new Error(failureCode);
      }

      const finalized = await finishClaim(supabase, claim, true, null);
      if (!finalized) {
        // The durable run record is idempotent. If this lease expired, a later
        // worker can safely observe the existing record and finish the schedule.
        failed += 1;
        logOperationalEvent({
          event: "scheduled_workflow",
          requestId,
          route: "/api/internal/scheduler",
          outcome: "failure",
          errorCode: "SCHEDULED_RUN_FINALIZATION_FAILED",
          durationMs: Math.min(600000, Math.max(0, Date.now() - workflowStartedAt)),
        }, console.error);
        continue;
      }
      succeeded += 1;
    } catch {
      try {
        await finishClaim(supabase, claim, false, failureCode);
      } catch {
        // The lease expires and can be retried if the database is temporarily unavailable.
      }
      failed += 1;
      logOperationalEvent({
        event: "scheduled_workflow",
        requestId,
        route: "/api/internal/scheduler",
        outcome: "failure",
        errorCode: failureCode,
        durationMs: Math.min(600000, Math.max(0, Date.now() - workflowStartedAt)),
      }, console.error);
    }
  }

  logOperationalEvent({
    event: "scheduler_tick",
    requestId,
    route: "/api/internal/scheduler",
    outcome: failed > 0 ? "failure" : "success",
    statusCode: 200,
    durationMs: Math.max(0, Date.now() - startedAt),
    claimed: claims.length,
    succeeded,
    failed,
  }, failed > 0 ? console.warn : console.info);

  return jsonResponse({ claimed: claims.length, succeeded, failed });
}

export async function GET(request: NextRequest) {
  return dispatchTick(request);
}

export async function POST(request: NextRequest) {
  return dispatchTick(request);
}
