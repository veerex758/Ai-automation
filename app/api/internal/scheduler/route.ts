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
    const status = secret ? 401 : 503;
    logOperationalEvent({
      event: "scheduler_tick",
      requestId,
      route: "/api/internal/scheduler",
      outcome: "rejected",
      statusCode: status,
      errorCode: secret ? "SCHEDULER_UNAUTHORIZED" : "SCHEDULER_AUTH_NOT_CONFIGURED",
      durationMs: Math.min(600000, Math.max(0, Date.now() - startedAt)),
    }, console.warn);
    return jsonResponse(
      { error: secret ? "Unauthorized." : "Scheduler authentication is not configured." },
      status,
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
      durationMs: Math.min(600000, Math.max(0, Date.now() - startedAt)),
    }, console.error);
    return jsonResponse({ error: "Scheduler database access is not configured." }, 503);
  }

  let data: unknown;
  let claimFailed = false;
  try {
    const claimResult = await supabase.rpc("claim_due_workflow_schedules", {
      p_limit: claimLimit,
      p_lease_seconds: leaseSeconds,
    });
    data = claimResult.data;
    claimFailed = Boolean(claimResult.error);
  } catch {
    claimFailed = true;
  }
  if (claimFailed || !Array.isArray(data)) {
    logOperationalEvent({
      event: "scheduler_tick",
      requestId,
      route: "/api/internal/scheduler",
      outcome: "failure",
      statusCode: 500,
      errorCode: "SCHEDULER_CLAIM_FAILED",
      durationMs: Math.min(600000, Math.max(0, Date.now() - startedAt)),
    }, console.error);
    return jsonResponse({ error: "Could not claim scheduled workflows." }, 500);
  }

  const claims = data as ScheduleClaim[];
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

      const startedAt = Date.now();
      const result = runDryRun(validated.definition, {});
      const durationMs = Math.min(600000, Math.max(0, Date.now() - startedAt));
      if (result.status !== "succeeded" || result.sideEffectsPerformed !== false) {
        throw new Error("SCHEDULED_RUN_FAILED");
      }

      const { error: persistError } = await supabase.rpc("record_scheduled_workflow_run", {
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
          statusCode: 500,
          errorCode: "SCHEDULED_RUN_FINALIZATION_FAILED",
          durationMs: Math.min(600000, Math.max(0, Date.now() - workflowStartedAt)),
        }, console.error);
        continue;
      }
      succeeded += 1;
      logOperationalEvent({
        event: "scheduled_workflow",
        requestId,
        route: "/api/internal/scheduler",
        outcome: "success",
        statusCode: 200,
        durationMs: Math.min(600000, Math.max(0, Date.now() - workflowStartedAt)),
      });
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
        statusCode: 500,
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
    claimed: claims.length,
    succeeded,
    failed,
    durationMs: Math.min(600000, Math.max(0, Date.now() - startedAt)),
  }, failed > 0 ? console.warn : console.info);
  return jsonResponse({ claimed: claims.length, succeeded, failed });
}

export async function GET(request: NextRequest) {
  return dispatchTick(request);
}

export async function POST(request: NextRequest) {
  return dispatchTick(request);
}
