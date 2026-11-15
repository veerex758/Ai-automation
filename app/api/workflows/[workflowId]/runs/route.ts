import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validateDefinition } from "@/lib/workflows/validate-definition.cjs";
import { runDryRun } from "@/lib/workflows/dry-run.cjs";
import { executeRegisteredWorkflow, type RegisteredWorkflowStep } from "@/nodes/workflow-runner";
import { validateRegisteredSteps } from "@/nodes/validate-steps";
import type { NodeContext } from "@/nodes/types";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const maxInputBytes = 10 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function dryRunContext(): Omit<NodeContext, "previousOutputs"> {
  return {
    credentials: {},
    logger: { info() {}, error() {} },
    http: { async request() { throw new Error("DRY_RUN_PROVIDER_CALL_BLOCKED"); } },
  };
}

type DryRunResult = {
  mode: "dry_run";
  status: "succeeded" | "failed";
  sideEffectsPerformed: false;
  steps: Array<{ stepId: string; position: number; type: "trigger" | "action" | "condition"; title: string; status: "simulated" | "skipped" | "failed"; message: string; conditionMatched?: boolean }>;
};

function privateJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function POST(request: NextRequest, context: { params: Promise<{ workflowId: string }> }) {
  const startedAt = Date.now();
  try {
    const { workflowId } = await context.params;
    if (!uuidPattern.test(workflowId)) return privateJson({ error: "Invalid workflow ID." }, { status: 400 });

    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (contentLength > maxInputBytes) {
      return privateJson({ error: "Dry-run input must be 10 KB or smaller." }, { status: 413 });
    }

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return privateJson({ error: "Authentication required." }, { status: 401 });

    let body: unknown;
    try { body = await request.json(); } catch {
      return privateJson({ error: "Request body must be valid JSON." }, { status: 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return privateJson({ error: "Request body must be an object." }, { status: 400 });
    }
    const requestBody = body as Record<string, unknown>;
    if (requestBody.mode !== undefined && requestBody.mode !== "dry_run") {
      return privateJson({ error: "Only dry-run mode is available; live execution is not enabled." }, { status: 400 });
    }
    const input = requestBody.input === undefined ? {} : requestBody.input;
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return privateJson({ error: "Dry-run input must be a JSON object." }, { status: 400 });
    }
    if (Buffer.byteLength(JSON.stringify(input), "utf8") > maxInputBytes) {
      return privateJson({ error: "Dry-run input must be 10 KB or smaller." }, { status: 413 });
    }

    const { data: workflow, error: workflowError } = await supabase
      .from("workflows")
      .select("id, workspace_id, version, definition, status")
      .eq("id", workflowId)
      .maybeSingle();
    if (workflowError) throw workflowError;
    if (!workflow) return privateJson({ error: "Workflow not found or you do not have access to it." }, { status: 404 });
    if (workflow.status === "archived") {
      return privateJson({ error: "Archived workflows cannot be run." }, { status: 409 });
    }

    const validated = validateDefinition(workflow.definition);
    if (!validated.definition) {
      return privateJson({ error: "This workflow definition is invalid. Save a valid definition before testing." }, { status: 422 });
    }

    const storedDefinition = workflow.definition as Record<string, unknown> | null;
    let registrySteps: RegisteredWorkflowStep[] | null = null;
    if (storedDefinition?.format === "aivanta-registry-v1") {
      const checked = validateRegisteredSteps(storedDefinition.steps);
      if (!checked.steps) return privateJson({ error: checked.error || "This registry workflow is invalid. Save a valid graph before testing." }, { status: 422 });
      registrySteps = checked.steps;
    }

    // One workflow run is one execution, including a safe dry-run.
    const { data: executionUsage, error: executionUsageError } = await supabase.rpc("consume_workspace_usage", {
      p_workspace_id: workflow.workspace_id,
      p_metric: "workflow_execution",
      p_quantity: 1,
      p_metadata: { workflow_id: workflow.id, mode: "dry_run" },
    });
    if (executionUsageError) return privateJson({ error: "Execution billing meter unavailable. Apply the subscription migration." }, { status: 503 });
    if (!executionUsage?.allowed) return privateJson({ error: "Monthly workflow execution allowance reached. Upgrade your plan.", entitlement: executionUsage }, { status: 402 });

    let result: DryRunResult;
    let persistedSteps: Array<{ step_id: string; step_type: string; title: string; status: string; result: Record<string, unknown> }>;
    if (registrySteps) {
      const steps = registrySteps;
      const trigger = steps[0];
      const triggerOutput = trigger.nodeId === "webhooks"
        ? { eventId: "dry-run-event", eventType: "test", receivedAt: new Date().toISOString(), payload: input }
        : trigger.nodeId === "schedule" ? trigger.input : { started: true, payload: input };
      const execution = await executeRegisteredWorkflow({
        steps, context: dryRunContext(), dryRun: true,
        initialOutputs: { [trigger.id]: triggerOutput },
        completedStepIds: [trigger.id],
      });
      result = {
        mode: "dry_run",
        status: execution.status === "succeeded" ? "succeeded" : "failed",
        sideEffectsPerformed: false,
        steps: execution.steps.map((step, index) => {
          const definitionStep = steps[index];
          const output = isRecord(step.output) ? step.output : {};
          return {
            stepId: step.stepId, position: index + 1,
            type: definitionStep.nodeId === "if" || definitionStep.nodeId === "switch" ? "condition" : definitionStep.kind,
            title: definitionStep.nodeId + "." + definitionStep.operationId,
            status: step.status === "succeeded" ? "simulated" : step.status,
            message: step.status === "skipped" ? "This branch was not selected." : step.status === "failed" ? (step.error || "This step failed.") : "No external action was executed.",
            ...(typeof output.matched === "boolean" ? { conditionMatched: output.matched } : {}),
          };
        }),
      };
      persistedSteps = execution.steps.map((step, index) => {
        const definitionStep = steps[index];
        const output = isRecord(step.output) ? step.output : {};
        const status = step.status === "succeeded" ? "simulated" : step.status;
        return {
          step_id: step.stepId,
          step_type: definitionStep.nodeId === "if" || definitionStep.nodeId === "switch" ? "condition" : definitionStep.kind,
          title: definitionStep.nodeId + "." + definitionStep.operationId,
          status,
          result: step.status === "failed" ? { engine: "registry-v1", error: step.error || "STEP_FAILED" } : {
            engine: "registry-v1",
            message: step.status === "skipped" ? "This branch was not selected." : "No provider action was executed.",
            ...(typeof output.route === "string" ? { route: output.route } : {}),
            ...(typeof output.matched === "boolean" ? { conditionMatched: output.matched } : {}),
          },
        };
      });
    } else {
      const legacy = runDryRun(validated.definition, input as Record<string, unknown>);
      result = legacy as DryRunResult;
      persistedSteps = legacy.steps.map((step) => ({
        step_id: step.stepId, step_type: step.type, title: step.title, status: step.status,
        result: { message: step.message, ...(step.conditionMatched === undefined ? {} : { conditionMatched: step.conditionMatched }) },
      }));
    }
    const durationMs = Math.max(0, Date.now() - startedAt);
    const { data, error: runError } = await supabase.rpc("record_workflow_dry_run", {
      p_workflow_id: workflow.id,
      p_expected_version: workflow.version,
      p_status: result.status,
      p_duration_ms: durationMs,
      p_error_message: result.status === "failed" ? "One or more workflow steps failed." : null,
      p_steps: persistedSteps,
    });
    if (runError) {
      if (runError.code === "P0002") return privateJson({ error: "Workflow not found or you do not have access to it." }, { status: 404 });
      if (runError.code === "40001") return privateJson({ error: "This workflow changed during the test. Reload it and try again." }, { status: 409 });
      if (runError.code === "22023") return privateJson({ error: "This workflow could not be recorded safely." }, { status: 422 });
      throw runError;
    }
    const saved = Array.isArray(data) ? data[0] : data;
    if (!saved) throw new Error("The dry-run was not recorded.");

    return privateJson({
      run: {
        id: saved.run_id,
        mode: "dry_run",
        status: result.status,
        workflow_version: saved.workflow_version,
        duration_ms: durationMs,
      },
      result,
      persisted: true,
      sideEffectsPerformed: false,
    }, { status: 201 });
  } catch (error) {
    console.error("Failed to run Aivanta workflow dry-run:", error);
    return privateJson({ error: "Could not complete this workflow dry-run. Try again." }, { status: 500 });
  }
}

export async function GET(_request: NextRequest, context: { params: Promise<{ workflowId: string }> }) {
  try {
    const { workflowId } = await context.params;
    if (!uuidPattern.test(workflowId)) return privateJson({ error: "Invalid workflow ID." }, { status: 400 });

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return privateJson({ error: "Authentication required." }, { status: 401 });

    const { data: workflow, error: workflowError } = await supabase
      .from("workflows")
      .select("id, workspace_id")
      .eq("id", workflowId)
      .maybeSingle();
    if (workflowError) throw workflowError;
    if (!workflow) return privateJson({ error: "Workflow not found or you do not have access to it." }, { status: 404 });

    const { data: runs, error: runsError } = await supabase
      .from("workflow_runs")
      .select("id, mode, status, workflow_version, started_at, completed_at, duration_ms, created_at")
      .eq("workflow_id", workflowId)
      .eq("workspace_id", workflow.workspace_id)
      .order("created_at", { ascending: false })
      .limit(25);
    if (runsError) throw runsError;

    const runIds = (runs ?? []).map((run) => run.id);
    if (runIds.length === 0) return privateJson({ runs: [] });

    // History UI needs only safe metadata; do not return persisted step results,
    // inputs, outputs, or provider payloads from this endpoint.
    const { data: steps, error: stepsError } = await supabase
      .from("workflow_run_steps")
      .select("id, run_id, position, title, status")
      .in("run_id", runIds)
      .order("position", { ascending: true });
    if (stepsError) throw stepsError;

    return privateJson({
      runs: (runs ?? []).map((run) => ({
        ...run,
        steps: (steps ?? []).filter((step) => step.run_id === run.id),
      })),
    });
  } catch (error) {
    console.error("Failed to load Aivanta workflow run history:", error);
    return privateJson({ error: "Could not load workflow run history. Try again." }, { status: 500 });
  }
}
