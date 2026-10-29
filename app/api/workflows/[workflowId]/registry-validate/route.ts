import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { findOperation } from "@/nodes/registry";
import type { RegisteredWorkflowStep } from "@/nodes/workflow-runner";

export const dynamic = "force-dynamic";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const stepIdPattern = /^[a-zA-Z0-9_-]{1,64}$/;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const providerForNode: Record<string, string> = {
  openai: "openai",
  gemini: "gemini",
  slack: "slack",
  email: "resend",
  http: "http",
};

type ValidationIssue = { stepId: string; code: string; message: string };

export async function POST(request: NextRequest, context: { params: Promise<{ workflowId: string }> }) {
  try {
    const { workflowId } = await context.params;
    if (!uuid.test(workflowId)) return NextResponse.json({ error: "Invalid workflow ID." }, { status: 400 });

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

    let body: unknown;
    try { body = await request.json(); } catch {
      return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
    }
    if (!isRecord(body) || !Array.isArray(body.steps)) {
      return NextResponse.json({ error: "Provide registry workflow steps to validate." }, { status: 400 });
    }

    const { data: workflow, error: workflowError } = await supabase.from("workflows")
      .select("id,workspace_id").eq("id", workflowId).maybeSingle();
    if (workflowError) throw workflowError;
    if (!workflow) return NextResponse.json({ error: "Workflow not found or access denied." }, { status: 404 });

    const steps = body.steps as RegisteredWorkflowStep[];
    const issues: ValidationIssue[] = [];
    const missingConnections: Array<{ provider: string; label: string; reason: string }> = [];
    if (steps.length < 1 || steps.length > 30) {
      issues.push({ stepId: "", code: "STEP_LIMIT", message: "A workflow must contain between 1 and 30 steps." });
    }

    const first = steps[0] as unknown;
    if (!isRecord(first) || first.kind !== "trigger" || first.nodeId !== "manual" || first.operationId !== "start") {
      issues.push({ stepId: isRecord(first) && typeof first.id === "string" ? first.id : "", code: "TRIGGER_REQUIRED", message: "Start with the Manual trigger for this Quick Setup flow." });
    }
    if (steps.slice(1).some((step) => isRecord(step) && step.kind === "trigger")) {
      issues.push({ stepId: "", code: "TRIGGER_POSITION", message: "Only the first step may be a trigger." });
    }

    const seen = new Map<string, number>();
    const usedProviders = new Set<string>();
    for (const [index, rawStep] of steps.entries()) {
      if (!isRecord(rawStep) || typeof rawStep.id !== "string" || typeof rawStep.nodeId !== "string" ||
          typeof rawStep.operationId !== "string" || !["trigger", "action"].includes(String(rawStep.kind)) ||
          !("input" in rawStep)) {
        issues.push({ stepId: "", code: "STEP_SHAPE", message: `Step ${index + 1} has an invalid structure.` });
        continue;
      }
      const step = rawStep as unknown as RegisteredWorkflowStep;
      if (!stepIdPattern.test(step.id)) issues.push({ stepId: step.id, code: "STEP_ID", message: "Use a step ID with letters, numbers, hyphens, or underscores (up to 64 characters)." });
      if (seen.has(step.id)) issues.push({ stepId: step.id, code: "DUPLICATE_STEP_ID", message: "Step IDs must be unique." });
      else seen.set(step.id, index);

      const operation = findOperation(step.nodeId, step.operationId, step.kind);
      if (!operation) {
        issues.push({ stepId: step.id, code: "OPERATION_NOT_FOUND", message: "This node operation is not registered." });
        continue;
      }
      const parsed = operation.inputSchema.safeParse(step.input);
      if (!parsed.success) issues.push({ stepId: step.id, code: "INPUT_SCHEMA", message: parsed.error.issues.map((issue) => issue.path.length ? issue.path.join(".") + ": " + issue.message : issue.message).join("; ") });

      const serialized = JSON.stringify(step.input) ?? "";
      const referencePattern = /\{\{([a-zA-Z0-9_-]{1,64}(?:\.[a-zA-Z0-9_-]{1,64})*)\}\}/g;
      for (const match of serialized.matchAll(referencePattern)) {
        const referencePath = match[1];
        const sourceId = referencePath.split(".")[0];
        const sourceIndex = seen.get(sourceId);
        if (sourceIndex === undefined || sourceIndex >= index) {
          issues.push({ stepId: step.id, code: "REFERENCE_ORDER", message: `Data reference {{${referencePath}}} must point to an earlier step.` });
        }
      }

      const provider = providerForNode[step.nodeId];
      if (step.kind === "action" && provider) usedProviders.add(provider);
    }

    let integrationRows: Array<{ provider: string; status: string; last_test_status: string | null }> = [];
    if (usedProviders.size) {
      const { data, error } = await supabase.from("workspace_integrations")
        .select("provider,status,last_test_status")
        .eq("workspace_id", workflow.workspace_id);
      if (error) {
        return NextResponse.json({
          error: "Workspace connection status is unavailable. Apply the reviewed integration migration to staging before validating connected providers.",
          code: "INTEGRATIONS_NOT_READY",
          valid: issues.length === 0,
          ready: false,
          issues,
          missingConnections: [...usedProviders].map((provider) => ({ provider, label: provider, reason: "Connection status could not be checked." })),
          checks: { nodeSchemas: issues.length === 0, dataMappings: issues.length === 0, connections: false, executed: false },
        }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
      }
      integrationRows = (data ?? []) as typeof integrationRows;
      for (const provider of usedProviders) {
        const integration = integrationRows.find((row) => row.provider === provider);
        if (!integration || integration.status !== "connected" || integration.last_test_status !== "passed") {
          missingConnections.push({
            provider,
            label: ({ openai: "OpenAI", gemini: "Google Gemini", slack: "Slack", resend: "Resend Email", http: "Custom HTTPS API" } as Record<string, string>)[provider] ?? provider,
            reason: !integration ? "Not connected in this workspace." : integration.last_test_status === "failed" ? "Connection test failed; reconnect or test again." : "Connection has not passed its test yet.",
          });
        }
      }
    }

    const valid = issues.length === 0;
    const ready = valid && missingConnections.length === 0;
    return NextResponse.json({
      valid,
      ready,
      issues,
      missingConnections,
      checks: {
        nodeSchemas: valid,
        dataMappings: valid,
        connections: missingConnections.length === 0,
        executed: false,
      },
      message: ready
        ? "All node inputs, data mappings, and required workspace connections passed validation."
        : valid
          ? "Node configuration is valid, but required app connections still need attention."
          : "Fix the reported node or data-mapping issues before testing.",
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not validate this workflow setup." }, { status: 500, headers: { "Cache-Control": "private, no-store" } });
  }
}
