import { NextResponse, type NextRequest } from "next/server";
import { POST as dispatch } from "../dispatch/route";
import { POST as safeRun } from "../runs/route";

const maxInputBytes = 10 * 1024;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

/** Compatibility alias. All live execution is queued through durable dispatch. */
export async function POST(request: NextRequest, context: { params: Promise<{ workflowId: string }> }) {
  let payload: unknown;
  try { payload = await request.json(); } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  if (!isRecord(payload)) return NextResponse.json({ error: "Request must be a JSON object." }, { status: 400 });
  if ((payload.mode !== undefined && payload.mode !== "live" && payload.mode !== "dry_run") ||
      (payload.dryRun !== undefined && typeof payload.dryRun !== "boolean") ||
      (payload.mode === "live" && payload.dryRun === true) ||
      (payload.mode === "dry_run" && payload.dryRun === false)) {
    return NextResponse.json({ error: "Mode must be live or dry_run, without conflicting flags." }, { status: 400 });
  }
  const input = payload.input === undefined ? {} : payload.input;
  if (!isRecord(input)) return NextResponse.json({ error: "Input must be a JSON object." }, { status: 400 });
  if (Buffer.byteLength(JSON.stringify(input), "utf8") > maxInputBytes) {
    return NextResponse.json({ error: "Input must be 10 KB or smaller." }, { status: 413 });
  }
  const mode = payload.mode === "dry_run" || payload.dryRun === true ? "dry_run" : "live";
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  headers.delete("x-aivanta-runner");
  headers.set("content-type", "application/json");
  const forwarded = new NextRequest(request.url, {
    method: "POST",
    headers,
    body: JSON.stringify({ mode, input }),
  });
  return mode === "dry_run" ? safeRun(forwarded, context) : dispatch(forwarded, context);
}
