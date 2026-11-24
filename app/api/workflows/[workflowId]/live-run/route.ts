import { NextRequest, NextResponse } from "next/server";
import { POST as dispatch } from "../dispatch/route";
import { POST as safeRun } from "../runs/route";
import { getRequestId, logOperationalEvent } from "@/lib/observability/safe-log.cjs";

const maxInputBytes = 10 * 1024;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

/** Compatibility alias. All live execution is queued through durable dispatch. */
export async function POST(request: NextRequest, context: { params: Promise<{ workflowId: string }> }) {
  const startedAt = Date.now();
  const requestId = getRequestId(request.headers.get("x-request-id"));
  const jsonResponse = (body: unknown, status: number) => {
    const response = NextResponse.json(body, { status });
    response.headers.set("x-request-id", requestId);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  };
  let payload: unknown;
  try { payload = await request.json(); } catch {
    return jsonResponse({ error: "Request body must be valid JSON." }, 400);
  }
  if (!isRecord(payload)) return jsonResponse({ error: "Request must be a JSON object." }, 400);
  if ((payload.mode !== undefined && payload.mode !== "live" && payload.mode !== "dry_run") ||
      (payload.dryRun !== undefined && typeof payload.dryRun !== "boolean") ||
      (payload.mode === "live" && payload.dryRun === true) ||
      (payload.mode === "dry_run" && payload.dryRun === false)) {
    return jsonResponse({ error: "Mode must be live or dry_run, without conflicting flags." }, 400);
  }
  const input = payload.input === undefined ? {} : payload.input;
  if (!isRecord(input)) return jsonResponse({ error: "Input must be a JSON object." }, 400);
  if (Buffer.byteLength(JSON.stringify(input), "utf8") > maxInputBytes) {
    return jsonResponse({ error: "Input must be 10 KB or smaller." }, 413);
  }
  const mode = payload.mode === "dry_run" || payload.dryRun === true ? "dry_run" : "live";
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  headers.delete("x-aivanta-runner");
  headers.set("content-type", "application/json");
  headers.set("x-request-id", requestId);
  const forwarded = new NextRequest(request.url, {
    method: "POST",
    headers,
    body: JSON.stringify({ mode, input }),
  });
  const response = mode === "dry_run" ? await safeRun(forwarded, context) : await dispatch(forwarded, context);
  response.headers.set("x-request-id", requestId);
  logOperationalEvent({
    event: "live_workflow_run", requestId, route: "/api/workflows/live-run",
    outcome: response.ok ? "success" : response.status < 500 ? "rejected" : "failure",
    statusCode: response.status, durationMs: Math.max(0, Date.now() - startedAt),
    ...(!response.ok && response.status >= 500 ? { errorCode: "LIVE_RUN_FAILED" } : {}),
  }, response.ok ? console.info : console.warn);
  return response;
}
