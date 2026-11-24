import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hasWorkspacePermission } from "@/lib/supabase/permissions";
import { nextCronOccurrence, validateCronExpression } from "@/lib/workflows/cron";
import { validateDefinition } from "@/lib/workflows/validate-definition.cjs";
import { validateRegisteredSteps } from "@/nodes/validate-steps";
import { enforceDistributedRateLimit } from "@/lib/security/distributed-rate-limit";

export const runtime = "nodejs";
function privateJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export const dynamic = "force-dynamic";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest, context: { params: Promise<{ workflowId: string }> }) {
  try {
    const { workflowId } = await context.params;
    if (!uuid.test(workflowId)) return privateJson({ error: "Invalid workflow ID." }, { status: 400 });
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return privateJson({ error: "Authentication required." }, { status: 401 });

    const { data: workflow, error: workflowError } = await supabase.from("workflows")
      .select("id,workspace_id,status,definition").eq("id", workflowId).maybeSingle();
    if (workflowError) throw workflowError;
    if (!workflow) return privateJson({ error: "Workflow not found or access denied." }, { status: 404 });
    if (!(await hasWorkspacePermission(supabase, workflow.workspace_id, user.id, "workflows.execute"))) return privateJson({ error: "Workspace workflows.execute permission required." }, { status: 403 });
    if (workflow.status !== "active") return privateJson({ error: "Activate the workflow before scheduling it." }, { status: 409 });
    const rateLimit = await enforceDistributedRateLimit(request, {
      scope: "workflow-schedule-write", windowMs: 5 * 60_000,
      ipLimit: 10, userId: user.id, userLimit: 10,
      workspaceId: workflow.workspace_id, workspaceLimit: 30,
      resourceId: workflowId, resourceLimit: 5,
    });
    if (rateLimit) return rateLimit;
    const rawDefinition = workflow.definition as Record<string, unknown> | null;
    if (rawDefinition?.format === "aivanta-registry-v1") {
      const registry = validateRegisteredSteps(rawDefinition.steps);
      if (!registry.steps || registry.steps[0]?.nodeId !== "schedule" || registry.steps[0]?.operationId !== "scheduled") {
        return privateJson({ error: "This schedule endpoint requires a registry Schedule/Cron trigger." }, { status: 422 });
      }
    } else {
      const validated = validateDefinition(workflow.definition);
      if (!validated.definition || validated.definition.nodes[0]?.type !== "trigger" ||
          validated.definition.nodes[0]?.settings.event !== "schedule") {
        return privateJson({ error: "This schedule endpoint requires a valid Schedule trigger." }, { status: 422 });
      }
    }

    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (contentLength > 8192 || new TextEncoder().encode(await request.clone().text()).byteLength > 8192) return privateJson({ error: "Schedule request exceeds 8 KiB." }, { status: 413 });
    let body: unknown;
    try { body = await request.json(); } catch { return privateJson({ error: "Request body must be valid JSON." }, { status: 400 }); }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return privateJson({ error: "Provide a cronExpression and timezone." }, { status: 400 });
    }
    const input = body as Record<string, unknown>;
    if (typeof input.cronExpression !== "string" || typeof input.timezone !== "string" ||
        input.cronExpression.length > 100 || input.timezone.length > 100) {
      return privateJson({ error: "Provide a five-field cron expression and IANA timezone." }, { status: 400 });
    }
    let nextRunAt: string;
    try {
      validateCronExpression(input.cronExpression);
      nextRunAt = nextCronOccurrence(input.cronExpression, input.timezone);
    } catch (error) {
      return privateJson({ error: error instanceof Error ? error.message : "Invalid cron schedule." }, { status: 400 });
    }
    const { error: saveError } = await supabase.from("workflow_schedules").upsert({
      workflow_id: workflow.id,
      workspace_id: workflow.workspace_id,
      interval_minutes: 60,
      enabled: true,
      next_run_at: nextRunAt,
      cron_expression: input.cronExpression.trim(),
      timezone: input.timezone,
    } as never, { onConflict: "workflow_id" });
    if (saveError) throw saveError;
    return privateJson({ success: true, enabled: true, cronExpression: input.cronExpression.trim(), timezone: input.timezone, nextRunAt });
  } catch (error) {
    console.error("Aivanta cron schedule save failed.", error);
    return privateJson({ error: "Could not save this cron schedule." }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ workflowId: string }> }) {
  try {
    const { workflowId } = await context.params;
    if (!uuid.test(workflowId)) return privateJson({ error: "Invalid workflow ID." }, { status: 400 });
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return privateJson({ error: "Authentication required." }, { status: 401 });
    const { data: workflow, error: workflowError } = await supabase.from("workflows")
      .select("id,workspace_id").eq("id", workflowId).maybeSingle();
    if (workflowError) throw workflowError;
    if (!workflow || !(await hasWorkspacePermission(supabase, workflow.workspace_id, user.id, "workflows.execute"))) {
      return privateJson({ error: "Workspace workflows.execute permission required." }, { status: 403 });
    }
    const rateLimit = await enforceDistributedRateLimit(_request, {
      scope: "workflow-schedule-delete", windowMs: 5 * 60_000,
      ipLimit: 10, userId: user.id, userLimit: 10,
      workspaceId: workflow.workspace_id, workspaceLimit: 30,
      resourceId: workflowId, resourceLimit: 5,
    });
    if (rateLimit) return rateLimit;
    const { data, error } = await supabase.from("workflow_schedules")
      .update({ enabled: false }).eq("workflow_id", workflowId).eq("workspace_id", workflow.workspace_id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) return privateJson({ error: "Schedule not found or currently leased by the scheduler." }, { status: 409 });
    return privateJson({ success: true, enabled: false });
  } catch (error) {
    console.error("Aivanta cron schedule disable failed.", error);
    return privateJson({ error: "Could not disable this schedule." }, { status: 500 });
  }
}
