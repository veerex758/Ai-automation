import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createRealEstateServiceClient } from "@/lib/real-estate/server";
import { processRealEstateLeadPipeline } from "@/lib/real-estate/pipeline";
import { processDueRealEstateFollowups } from "@/app/api/cron/real-estate-followups/route";

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
  if (!authorized(request)) {
    const configured = Boolean(process.env.CRON_SECRET ?? process.env.AIVANTA_SCHEDULER_SECRET);
    return NextResponse.json(
      { error: configured ? "Unauthorized." : "Cron authentication is not configured." },
      { status: configured ? 401 : 503 },
    );
  }
  try {
    const db = createRealEstateServiceClient();
    const pipeline = await processRealEstateLeadPipeline({ db, limit: 20 });
    const followups = await processDueRealEstateFollowups(db);
    return NextResponse.json({ success: true, pipeline, followups });
  } catch (error) {
    console.error("Real-estate automation tick failed", error);
    return NextResponse.json({ error: "Could not process the real-estate automation queue." }, { status: 500 });
  }
}

export async function GET(request: NextRequest) { return run(request); }
export async function POST(request: NextRequest) { return run(request); }
