import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { runDurableWorker } from "@/lib/workflows/durable-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET ?? process.env.AIVANTA_WORKER_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

async function tick(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized or worker secret not configured." }, { status: 401 });
  }
  try {
    return NextResponse.json(await runDurableWorker());
  } catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_]{1,64}$/.test(error.message)
      ? error.message : "WORKER_FAILED";
    const status = code === "WORKER_DATABASE_NOT_CONFIGURED" ? 503 : 500;
    console.error("Aivanta durable worker request failed.", { errorCode: code });
    return NextResponse.json({ error: "Could not process queued workflow executions." }, { status });
  }
}

export async function POST(request: NextRequest) { return tick(request); }
export async function GET(request: NextRequest) { return tick(request); }
