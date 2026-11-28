import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createRealEstateServiceClient } from "@/lib/real-estate/server";
import { processRealEstateLeadPipeline } from "@/lib/real-estate/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET ?? process.env.AIVANTA_SCHEDULER_SECRET;
  if (!secret) return false;
  const expected = Buffer.from("Bearer " + secret);
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

async function run(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (process.env.REAL_ESTATE_PIPELINE_ENABLED !== "true" || process.env.AIVANTA_LIVE_EXECUTION_ENABLED !== "true") {
    return NextResponse.json({ success: true, enabled: false, claimed: 0, completed: 0, blocked: 0, failed: 0 });
  }
  try {
    const db = createRealEstateServiceClient();
    const result = await processRealEstateLeadPipeline({ db, limit: 20 });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Real-estate pipeline worker failed", error);
    return NextResponse.json({ error: "Could not process real-estate lead pipeline." }, { status: 500 });
  }
}

export async function GET(request: NextRequest) { return run(request); }
export async function POST(request: NextRequest) { return run(request); }
