import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveDeadLetterOperator } from "@/lib/operations/dead-letter-access";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ deadLetterId: string }> },
) {
  try {
    const { deadLetterId } = await context.params;
    if (!uuidPattern.test(deadLetterId)) {
      return NextResponse.json({ error: "Invalid dead-letter identifier." }, { status: 400, headers });
    }

    const requestId = request.headers.get("idempotency-key")?.trim() ?? "";
    if (!uuidPattern.test(requestId)) {
      return NextResponse.json({ error: "A valid Idempotency-Key UUID is required." }, { status: 400, headers });
    }

    const resolved = await resolveDeadLetterOperator();
    if (!resolved.ok) return resolved.response;

    const { workspace, user } = resolved.context;
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("create_dead_letter_dry_run_recovery", {
      p_dead_letter_id: deadLetterId,
      p_workspace_id: workspace.id,
      p_created_by: user.id,
      p_request_id: requestId,
    });

    if (error) {
      if (error.code === "P0002") {
        return NextResponse.json({ error: "Dead letter not found in the active workspace." }, { status: 404, headers });
      }
      if (error.code === "22023") {
        return NextResponse.json({ error: "Only permanently failed dry-run jobs can be recovered here. Live jobs require provider reconciliation first." }, { status: 409, headers });
      }
      throw error;
    }

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("DEAD_LETTER_RECOVERY_RESPONSE_INVALID");
    }
    const result = data as { job_id?: unknown; run_id?: unknown; recovery_id?: unknown; mode?: unknown; duplicate?: unknown };
    if (typeof result.job_id !== "string" || typeof result.run_id !== "string" ||
        typeof result.recovery_id !== "string" || result.mode !== "dry_run") {
      throw new Error("DEAD_LETTER_RECOVERY_RESPONSE_INVALID");
    }

    return NextResponse.json({
      recovery_id: result.recovery_id,
      job_id: result.job_id,
      run_id: result.run_id,
      mode: "dry_run",
      duplicate: result.duplicate === true,
      message: result.duplicate === true
        ? "This recovery request was already queued."
        : "A new dry-run recovery was queued. No provider action was enabled.",
    }, { status: result.duplicate === true ? 200 : 202, headers });
  } catch (error) {
    console.error("Dead-letter recovery failed.", {
      errorCode: error instanceof Error && /^[A-Z0-9_]{1,64}$/.test(error.message) ? error.message : "DEAD_LETTER_RECOVERY_FAILED",
    });
    return NextResponse.json({ error: "Could not create the dry-run recovery." }, { status: 503, headers });
  }
}
