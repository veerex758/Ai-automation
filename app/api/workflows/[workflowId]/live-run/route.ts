import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validateDefinition } from "@/lib/workflows/validate-definition.cjs";
import { runDryRun } from "@/lib/workflows/dry-run.cjs";
import { sendResendEmail, isResendConfigured, isLiveEmailRecipientAllowed, getAllowedRecipients } from "@/lib/integrations/resend.cjs";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const maxInputBytes = 10 * 1024;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

export async function POST(request: NextRequest, context: { params: Promise<{ workflowId: string }> }) {
  const startedAt = Date.now();
  try {
    const { workflowId } = await context.params;
    if (!uuidPattern.test(workflowId)) return NextResponse.json({ error: "Invalid workflow ID." }, { status: 400 });

    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (contentLength > maxInputBytes) return NextResponse.json({ error: "Run input must be 10 KB or smaller." }, { status: 413 });

    const idempotencyKey = request.headers.get("idempotency-key") ?? "";
    if (!uuidPattern.test(idempotencyKey)) {
      return NextResponse.json({ error: "A UUID Idempotency-Key header is required for live execution." }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

    if (process.env.AIVANTA_LIVE_EXECUTION_ENABLED !== "true") {
      return NextResponse.json({ error: "Live execution is disabled by the server. Configure AIVANTA_LIVE_EXECUTION_ENABLED=true only when you are ready to send real email." }, { status: 503 });
    }
    if (!isResendConfigured()) {
      return NextResponse.json({ error: "Email integration is not configured. Add RESEND_API_KEY and RESEND_FROM_EMAIL to the server environment." }, { status: 503 });
    }

    const { data: priorRun, error: priorRunError } = await supabase.from("workflow_runs")
      .select("id, status, workflow_version, mode, created_at")
      .eq("idempotency_key", idempotencyKey)
      .eq("created_by", user.id)
      .eq("workflow_id", workflowId)
      .maybeSingle();
    if (priorRunError) throw priorRunError;
    if (priorRun) return NextResponse.json({
      run: priorRun,
      duplicate: true,
      message: "This idempotency key has already been processed. No second email was sent.",
    }, { status: 200 });

    let body: unknown;
    try { body = await request.json(); } catch {
      return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
    }
    if (!isRecord(body)) return NextResponse.json({ error: "Run request must be a JSON object." }, { status: 400 });
    const input = body.input === undefined ? {} : body.input;
    if (!isRecord(input)) return NextResponse.json({ error: "Run input must be a JSON object." }, { status: 400 });
    if (Buffer.byteLength(JSON.stringify(input), "utf8") > maxInputBytes) return NextResponse.json({ error: "Run input must be 10 KB or smaller." }, { status: 413 });

    const { data: workflow, error: workflowError } = await supabase.from("workflows")
      .select("id, workspace_id, version, definition, status")
      .eq("id", workflowId).maybeSingle();
    if (workflowError) throw workflowError;
    if (!workflow) return NextResponse.json({ error: "Workflow not found or you do not have access to it." }, { status: 404 });
    if (workflow.status !== "active") return NextResponse.json({ error: "Activate this workflow before running live actions." }, { status: 409 });

    const validated = validateDefinition(workflow.definition);
    if (!validated.definition) return NextResponse.json({ error: "Save a valid workflow definition before live execution." }, { status: 422 });
    if (validated.definition.nodes[0]?.type !== "trigger" || validated.definition.nodes[0]?.settings.event !== "manual") {
      return NextResponse.json({ error: "The first live integration currently supports manual-trigger workflows only." }, { status: 422 });
    }

    const actions = validated.definition.nodes.filter((node) => node.type === "action");
    if (actions.length > 1) return NextResponse.json({ error: "The first live release supports one action per run to keep external side effects controlled." }, { status: 422 });
    const emailAction = actions[0];
    if (!emailAction || emailAction.settings.provider !== "email" || emailAction.settings.operation !== "send_email") {
      return NextResponse.json({ error: "The first live integration supports one Resend email action. Other providers remain in safe preview mode." }, { status: 422 });
    }
    if (!emailAction.settings.message?.trim()) return NextResponse.json({ error: "Add a message to the email action before running live." }, { status: 422 });
    if (getAllowedRecipients().length === 0) {
      return NextResponse.json({ error: "Live email is not configured. Add AIVANTA_LIVE_EMAIL_RECIPIENTS to the server environment." }, { status: 503 });
    }
    if (!isLiveEmailRecipientAllowed(emailAction.settings.recipient)) {
      return NextResponse.json({ error: "This recipient is not on the server-configured live email allowlist." }, { status: 403 });
    }

    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: recentLiveRuns, error: rateLimitError } = await supabase.from("workflow_runs")
      .select("id", { count: "exact", head: true })
      .eq("created_by", user.id)
      .eq("mode", "live")
      .gte("created_at", hourAgo);
    if (rateLimitError) throw rateLimitError;
    if ((recentLiveRuns ?? 0) >= 10) {
      return NextResponse.json({ error: "Live run limit reached. A maximum of 10 live runs per user per hour is allowed." }, { status: 429 });
    }

    const preview = runDryRun(validated.definition, input);
    const { data: run, error: insertError } = await supabase.from("workflow_runs").insert({
      workspace_id: workflow.workspace_id,
      workflow_id: workflow.id,
      workflow_version: workflow.version,
      mode: "live",
      status: "running",
      created_by: user.id,
      idempotency_key: idempotencyKey,
      started_at: new Date(startedAt).toISOString(),
      completed_at: new Date(startedAt).toISOString(),
      duration_ms: 0,
    }).select("id, workflow_version, started_at").single();

    if (insertError?.code === "23505") {
      const { data: existing, error: existingError } = await supabase.from("workflow_runs")
        .select("id, status, workflow_version, mode, created_at")
        .eq("idempotency_key", idempotencyKey)
        .eq("created_by", user.id)
        .eq("workflow_id", workflowId)
        .maybeSingle();
      if (existingError) throw existingError;
      if (existing) return NextResponse.json({
        run: existing,
        duplicate: true,
        message: "This idempotency key has already been processed. No second email was sent.",
      }, { status: 200 });
      return NextResponse.json({ error: "This live-run key has already been used." }, { status: 409 });
    }
    if (insertError) throw insertError;

    let emailSent = false;
    let providerMessageId: string | null = null;
    let failureMessage: string | null = null;
    let halted = false;
    const stepRows: Array<Record<string, unknown>> = [];

    for (const step of preview.steps) {
      const node = validated.definition.nodes[step.position - 1];
      let status: "simulated" | "skipped" | "executed" | "failed" = step.status;
      let result: Record<string, unknown> = { message: step.message };

      if (halted) {
        status = "skipped";
        result = { message: "Skipped because an earlier live action failed." };
      } else if (node.type === "action" && step.status === "simulated") {
        try {
          const sent = await sendResendEmail({
            to: node.settings.recipient,
            subject: node.title,
            text: node.settings.message,
          }, { idempotencyKey: run.id });
          emailSent = true;
          providerMessageId = sent.messageId;
          status = "executed";
          result = { message: "Email accepted by Resend.", provider: sent.provider, providerMessageId: sent.messageId };
        } catch (error) {
          halted = true;
          status = "failed";
          failureMessage = error instanceof Error ? error.message : "Email provider request failed.";
          result = { message: failureMessage };
        }
      } else if (node.type === "action") {
        result = { message: "Email action skipped because an earlier condition did not match." };
      }

      stepRows.push({
        run_id: run.id,
        workspace_id: workflow.workspace_id,
        step_id: step.stepId,
        position: step.position,
        step_type: step.type,
        title: step.title,
        status,
        result,
      });
    }

    const status = failureMessage ? "failed" : "succeeded";
    const durationMs = Math.min(600000, Math.max(0, Date.now() - startedAt));
    const { error: stepsError } = await supabase.from("workflow_run_steps").insert(stepRows);
    if (stepsError) throw stepsError;
    const { data: finalized, error: finalizeError } = await supabase.from("workflow_runs")
      .update({
        status,
        completed_at: new Date().toISOString(),
        duration_ms: durationMs,
        error_message: failureMessage,
      })
      .eq("id", run.id).eq("status", "running")
      .select("id, mode, status, workflow_version, started_at, completed_at, duration_ms, error_message")
      .single();
    if (finalizeError) throw finalizeError;

    return NextResponse.json({
      run: finalized,
      steps: stepRows.map((step) => ({ step_id: step.step_id, position: step.position, step_type: step.step_type, title: step.title, status: step.status, result: step.result })),
      sideEffectsPerformed: emailSent,
      ...(providerMessageId ? { providerMessageId } : {}),
    }, { status: 201 });
  } catch (error) {
    console.error("Failed to execute Aivanta live workflow:", error);
    return NextResponse.json({ error: "Could not complete this live workflow run. Check run history before retrying; an external email may already have been accepted." }, { status: 500 });
  }
}
