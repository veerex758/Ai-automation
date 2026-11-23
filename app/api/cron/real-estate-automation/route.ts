import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createRealEstateServiceClient } from "@/lib/real-estate/server";
import { processRealEstateLeadPipeline } from "@/lib/real-estate/pipeline";
import { processDueRealEstateFollowups } from "@/lib/real-estate/followups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function privateJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}


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
    return privateJson(
      { error: configured ? "Unauthorized." : "Cron authentication is not configured." },
      { status: configured ? 401 : 503 },
    );
  }
  const liveExecution = process.env.AIVANTA_LIVE_EXECUTION_ENABLED === "true";
  const pipelineEnabled = process.env.REAL_ESTATE_PIPELINE_ENABLED === "true";
  const followupsEnabled = process.env.REAL_ESTATE_FOLLOWUPS_ENABLED === "true";
  if (!liveExecution || (!pipelineEnabled && !followupsEnabled)) {
    return privateJson({
      success: true,
      enabled: false,
      reason: "REAL_ESTATE_LIVE_EXECUTION_DISABLED",
      pipeline: { enabled: false, claimed: 0, completed: 0, blocked: 0, failed: 0 },
      followups: { enabled: false, claimed: 0, sent: 0, retried: 0, failed: 0, blocked: 0, cancelled: 0 },
    });
  }
  try {
    const db = createRealEstateServiceClient();
    const pipeline = await processRealEstateLeadPipeline({ db, limit: 20 });
    const followups = await processDueRealEstateFollowups(db);
    return privateJson({ success: true, pipeline, followups });
  } catch (error) {
    console.error("Real-estate automation tick failed", error);
    return privateJson({ error: "Could not process the real-estate automation queue." }, { status: 500 });
  }
}

export async function GET(request: NextRequest) { return run(request); }
export async function POST(request: NextRequest) { return run(request); }
