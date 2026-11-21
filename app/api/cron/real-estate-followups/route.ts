import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createRealEstateServiceClient } from "@/lib/real-estate/server";
import { processDueRealEstateFollowups } from "@/lib/real-estate/followups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET ?? process.env.AIVANTA_SCHEDULER_SECRET;
  if (!secret) return false;
  const expected = Buffer.from("Bearer " + secret);
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

async function run(request: NextRequest) {
  const configured = Boolean(process.env.CRON_SECRET ?? process.env.AIVANTA_SCHEDULER_SECRET);
  if (!authorized(request)) {
    return NextResponse.json(
      { error: configured ? "Unauthorized." : "Cron authentication is not configured." },
      { status: configured ? 401 : 503 },
    );
  }
  try {
    const db = createRealEstateServiceClient();
    const counts = await processDueRealEstateFollowups(db);
    return NextResponse.json({ success: true, ...counts });
  } catch (error) {
    console.error("Real-estate follow-up worker failed", error);
    return NextResponse.json({ error: "Could not process real-estate follow-ups." }, { status: 500 });
  }
}

export async function GET(request: NextRequest) { return run(request); }
export async function POST(request: NextRequest) { return run(request); }
