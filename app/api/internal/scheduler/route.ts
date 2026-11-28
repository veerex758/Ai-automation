import { timingSafeEqual } from "node:crypto";
import { after, NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getAdminSupabaseConfig } from "@/lib/supabase/admin";
import { validateDefinition } from "@/lib/workflows/validate-definition.cjs";
import { nextCronOccurrence } from "@/lib/workflows/cron";
import { validateRegisteredSteps } from "@/nodes/validate-steps";
import { getRequestId, logOperationalEvent } from "@/lib/observability/safe-log.cjs";
import { callSchedulerRpc } from "@/lib/observability/scheduler-rpc.cjs";
import { durableLiveRetryAttempts, runDurableWorker, validateDurableLiveSteps } from "@/lib/workflows/durable-worker";


export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
  let config: ReturnType<typeof getAdminSupabaseConfig>;
  try { config = getAdminSupabaseConfig(); }
  catch { throw new Error("SCHEDULER_DATABASE_NOT_CONFIGURED"); }

  return createSupabaseClient(config.url, config.serviceRoleKey, {
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
  cronSchedule = false,
  nextRunAt?: string,
): Promise<boolean> {
  if (cronSchedule) {
    const { data, error } = await callSchedulerRpc(
      (name: string, args: Record<string, unknown>) => supabase.rpc(name, args),
      "finish_workflow_cron_schedule_claim",
      {
        p_schedule_id: claim.schedule_id,
        p_lease_token: claim.lease_token,
        p_succeeded: succeeded,
        p_next_run_at: nextRunAt ?? null,
        p_error_code: errorCode,
      },
    );
    return !error && data === true;
  }
  const { data, error } = await callSchedulerRpc(
    (name: string, args: Record<string, unknown>) => supabase.rpc(name, args),
    "finish_workflow_schedule_claim",
    {
      p_schedule_id: claim.schedule_id,
      p_lease_token: claim.lease_token,
      p_succeeded: succeeded,
      p_error_code: errorCode,
    },
  );
  if (error) return false;
  return data === true;
}

async function dispatchTick(request: NextRequest) {
  const requestId = getRequestId(request.headers.get("x-request-id"));
  const startedAt = Date.now();
  const jsonResponse = (body: unknown, init?: ResponseInit) => {
    const response = NextResponse.json(body, init);
    response.headers.set("x-request-id", requestId);
    response.headers.set("Cache-Control", "no-store");
    return response;
  };
  if (process.env.AIVANTA_WORKFLOW_SCHEDULER_ENABLED !== "true") {
    logOperationalEvent({ event: "scheduler_tick", requestId, route: "/api/internal/scheduler", outcome: "disabled", statusCode: 200 });
    return jsonResponse({ disabled: true, claimed: 0, queued: 0, failed: 0 });
  }
  if (!isAuthorized(request)) {
    const secret = process.env.CRON_SECRET ?? process.env.AIVANTA_SCHEDULER_SECRET;
    logOperationalEvent({ event: "scheduler_tick", requestId, route: "/api/internal/scheduler", outcome: "rejected", statusCode: secret ? 401 : 503, errorCode: secret ? "SCHEDULER_UNAUTHORIZED" : "SCHEDULER_AUTH_NOT_CONFIGURED" }, console.warn);
    return jsonResponse(
      { error: secret ? "Unauthorized." : "Scheduler authentication is not configured." },
      { status: secret ? 401 : 503 },
    );
  }

  let supabase: ReturnType<typeof createSchedulerClient>;
  try {
    supabase = createSchedulerClient();
  } catch {
    logOperationalEvent({ event: "scheduler_tick", requestId, route: "/api/internal/scheduler", outcome: "failure", statusCode: 503, errorCode: "SCHEDULER_DATABASE_NOT_CONFIGURED" }, console.error);
    return jsonResponse({ error: "Scheduler database access is not configured." }, { status: 503 });
  }

  const { data, error } = await callSchedulerRpc(
    (name: string, args: Record<string, unknown>) => supabase.rpc(name, args),
    "claim_due_workflow_schedules",
    { p_limit: claimLimit, p_lease_seconds: leaseSeconds },
  );
  if (error || !Array.isArray(data)) {
    logOperationalEvent({ event: "scheduler_tick", requestId, route: "/api/internal/scheduler", outcome: "failure", statusCode: 500, errorCode: "SCHEDULER_CLAIM_FAILED", durationMs: Math.max(0, Date.now() - startedAt) }, console.error);
    return jsonResponse({ error: "Could not claim scheduled workflows." }, { status: 500 });
  }

  const claims = data as ScheduleClaim[];
  let queued = 0;
  let failed = 0;

  for (const claim of claims) {
    let failureCode = "SCHEDULED_RUN_FAILED";
    let cronSchedule = false;
    let nextRunAt: string | undefined;
    try {
      const { data: scheduleConfig, error: scheduleConfigError } = await supabase.from("workflow_schedules")
        .select("cron_expression,timezone,created_by").eq("id", claim.schedule_id).maybeSingle();
      if (scheduleConfigError) throw new Error("SCHEDULE_CONFIG_LOOKUP_FAILED");
      if (scheduleConfig?.cron_expression) {
        cronSchedule = true;
        nextRunAt = nextCronOccurrence(scheduleConfig.cron_expression, scheduleConfig.timezone ?? "UTC");
      }
      if (typeof scheduleConfig?.created_by !== "string") throw new Error("SCHEDULE_CREATOR_NOT_FOUND");
      const rawDefinition = claim.definition as Record<string, unknown> | null;
      let registrySchedule = false;
      let registrySteps: ReturnType<typeof validateRegisteredSteps>["steps"] = undefined;
      let scheduledInput: Record<string, unknown> = {};
      const executionMode = process.env.AIVANTA_SCHEDULED_LIVE_EXECUTION_ENABLED === "true" &&
        process.env.AIVANTA_LIVE_EXECUTION_ENABLED === "true" ? "live" : "dry_run";
      if (rawDefinition?.format === "aivanta-registry-v1") {
        const registry = validateRegisteredSteps(rawDefinition.steps);
        if (!registry.steps || registry.steps[0]?.nodeId !== "schedule" || registry.steps[0]?.operationId !== "scheduled") {
          failureCode = "INVALID_WORKFLOW_DEFINITION";
          throw new Error(failureCode);
        }
        if (!cronSchedule || !scheduleConfig?.cron_expression) {
          failureCode = "CRON_CONFIGURATION_REQUIRED";
          throw new Error(failureCode);
        }
        registrySchedule = true;
        registrySteps = registry.steps;
        if (executionMode === "live") {
          const livePolicyError = validateDurableLiveSteps(registry.steps);
          if (livePolicyError) {
            failureCode = livePolicyError;
            throw new Error(failureCode);
          }
        }
      } else {
        if (executionMode === "live") {
          failureCode = "SCHEDULED_LIVE_REGISTRY_REQUIRED";
          throw new Error(failureCode);
        }
        const validated = validateDefinition(claim.definition);
        if (!validated.definition || validated.definition.nodes[0]?.type !== "trigger" ||
            validated.definition.nodes[0]?.settings.event !== "schedule") {
          failureCode = "INVALID_WORKFLOW_DEFINITION";
          throw new Error(failureCode);
        }
      }

      // Atomically enqueue the immutable active workflow snapshot. Live mode is
      // opt-in and validated against the same operation/connection policy as manual dispatch.
      const scheduledFor = new Date(claim.scheduled_for).toISOString();
      if (registrySchedule) {
        scheduledInput = {
          scheduledAt: scheduledFor,
          timezone: scheduleConfig?.timezone ?? "UTC",
          cronExpression: scheduleConfig?.cron_expression,
        };
      }
      const idempotencyKey = "schedule:" + claim.schedule_id + ":" + scheduledFor;
      const { data: dispatch, error: dispatchError } = await callSchedulerRpc(
        (name: string, args: Record<string, unknown>) => supabase.rpc(name, args),
        "dispatch_workflow_execution",
        {
          p_workspace_id: claim.workspace_id,
          p_workflow_id: claim.workflow_id,
          p_workflow_version: claim.workflow_version,
          p_created_by: scheduleConfig.created_by,
          p_idempotency_key: idempotencyKey,
          p_payload: { input: scheduledInput, source: "schedule", scheduleId: claim.schedule_id, scheduledFor },
          p_max_attempts: executionMode === "live" && registrySteps ? durableLiveRetryAttempts(registrySteps) : 5,
          p_execution_mode: executionMode,
        },
      );
      if (dispatchError || !dispatch || typeof dispatch !== "object" ||
          typeof (dispatch as Record<string, unknown>).job_id !== "string" ||
          typeof (dispatch as Record<string, unknown>).run_id !== "string") {
        failureCode = "SCHEDULED_QUEUE_DISPATCH_FAILED";
        throw new Error(failureCode);
      }


      const finalizedNextRunAt = cronSchedule && scheduleConfig?.cron_expression
        ? nextCronOccurrence(scheduleConfig.cron_expression, scheduleConfig.timezone ?? "UTC")
        : nextRunAt;
      const finalized = await finishClaim(supabase, claim, true, null, cronSchedule, finalizedNextRunAt);
      if (!finalized) {
        // The durable run record is idempotent. If this lease expired, a later
        // worker can safely observe the existing record and finish the schedule.
        failed += 1;
        logOperationalEvent({ event: "scheduled_workflow", requestId, route: "/api/internal/scheduler", outcome: "failure", statusCode: 500, errorCode: "SCHEDULED_RUN_FINALIZATION_FAILED" }, console.error);
        continue;
      }
      queued += 1;
    } catch {
      try {
        await finishClaim(supabase, claim, false, failureCode, cronSchedule);
      } catch {
        // The lease expires and can be retried if the database is temporarily unavailable.
      }
      failed += 1;
      logOperationalEvent({ event: "scheduled_workflow", requestId, route: "/api/internal/scheduler", outcome: "failure", statusCode: 500, errorCode: failureCode }, console.error);
    }
  }

  if (queued > 0) {
    after(async () => {
      try {
        const workerResult = await runDurableWorker();
        logOperationalEvent({
          event: "scheduler_worker_wake", requestId, route: "/api/internal/scheduler",
          outcome: workerResult.deadLettered > 0 ? "failure" : "success",
          statusCode: 200, claimed: workerResult.claimed, succeeded: workerResult.succeeded,
          retried: workerResult.retried, deadLettered: workerResult.deadLettered,
        });
      } catch {
        logOperationalEvent({ event: "scheduler_worker_wake", requestId, route: "/api/internal/scheduler", outcome: "failure", statusCode: 500, errorCode: "SCHEDULED_WORKER_WAKE_FAILED" }, console.error);
      }
    });
  }

  logOperationalEvent({ event: "scheduler_tick", requestId, route: "/api/internal/scheduler", outcome: failed > 0 ? "failure" : "success", statusCode: 200, durationMs: Math.max(0, Date.now() - startedAt), claimed: claims.length, succeeded: queued, failed });
  return jsonResponse({ claimed: claims.length, queued, failed });
}

export async function GET(request: NextRequest) {
  return dispatchTick(request);
}

export async function POST(request: NextRequest) {
  return dispatchTick(request);
}
