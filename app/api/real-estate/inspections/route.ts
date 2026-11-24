import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
import { hasWorkspacePermission } from "@/lib/supabase/permissions";
import { createRealEstateServiceClient } from "@/lib/real-estate/server";
import {
  assertRealEstateCalendarSlotAvailable,
  createRealEstateCalendarContext,
  getRealEstateGoogleCalendarAccessToken,
} from "@/lib/real-estate/google-calendar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const idempotency = /^[A-Za-z0-9._:-]{8,200}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function validTimeZone(value: string) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date()); return true; }
  catch { return false; }
}

async function authWorkspace() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { response: NextResponse.json({ error: "Authentication required." }, { status: 401, headers }) };
  const workspace = await getOrCreateDefaultWorkspace(supabase);
  if (!await hasWorkspacePermission(supabase, workspace.id, user.id, "workflows.execute")) {
    return { response: NextResponse.json({ error: "Workspace workflows.execute permission is required to book inspections." }, { status: 403, headers }) };
  }
  return { supabase, user, workspace };
}

export async function GET() {
  try {
    const auth = await authWorkspace();
    if ("response" in auth) return auth.response;
    const { data, error } = await auth.supabase.from("real_estate_inspection_bookings")
      .select("id,lead_id,property_id,agent_id,google_connection_id,calendar_id,start_at,end_at,time_zone,status,google_event_id,google_event_url,last_error_code,created_at,approved_at")
      .eq("workspace_id", auth.workspace.id)
      .order("start_at", { ascending: true })
      .limit(100);
    if (error) throw error;
    return NextResponse.json({ bookings: data ?? [] }, { headers });
  } catch (error) {
    console.error("Real-estate inspection list failed", error);
    return NextResponse.json({ error: "Could not load inspection bookings." }, { status: 503, headers });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authWorkspace();
    if ("response" in auth) return auth.response;
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > 5000) return NextResponse.json({ error: "Booking request exceeds 5 KiB." }, { status: 413, headers });
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400, headers }); }
    if (!isRecord(body)) return NextResponse.json({ error: "Booking request must be an object." }, { status: 400, headers });

    const leadId = body.leadId;
    const propertyId = body.propertyId ?? null;
    const agentId = body.agentId ?? null;
    const googleConnectionId = body.googleConnectionId;
    const calendarId = typeof body.calendarId === "string" ? body.calendarId.trim() : "primary";
    const startAt = body.startAt;
    const endAt = body.endAt;
    const timeZone = body.timeZone;
    const idempotencyKey = body.idempotencyKey;
    if (typeof leadId !== "string" || !uuid.test(leadId) ||
        (propertyId !== null && (typeof propertyId !== "string" || !uuid.test(propertyId))) ||
        (agentId !== null && (typeof agentId !== "string" || !uuid.test(agentId))) ||
        typeof googleConnectionId !== "string" || !uuid.test(googleConnectionId) ||
        typeof startAt !== "string" || !Number.isFinite(Date.parse(startAt)) ||
        typeof endAt !== "string" || !Number.isFinite(Date.parse(endAt)) ||
        typeof timeZone !== "string" || !validTimeZone(timeZone) ||
        typeof idempotencyKey !== "string" || !idempotency.test(idempotencyKey) ||
        !calendarId || calendarId.length > 300) {
      return NextResponse.json({ error: "Provide a valid lead, Google Calendar connection, future slot, timezone and unique request key." }, { status: 400, headers });
    }
    if (calendarId !== "primary") return NextResponse.json({ error: "This pilot currently books the selected Google account primary calendar only." }, { status: 400, headers });

    const start = new Date(startAt);
    const end = new Date(endAt);
    const now = Date.now();
    if (start.getTime() <= now || end.getTime() <= start.getTime() ||
        end.getTime() - start.getTime() < 5 * 60 * 1000 || end.getTime() - start.getTime() > 3 * 60 * 60 * 1000 ||
        start.getTime() > now + 180 * 24 * 60 * 60 * 1000) {
      return NextResponse.json({ error: "Inspection must be in the next 180 days and last between 1 minute and 3 hours." }, { status: 400, headers });
    }

    const { data: lead, error: leadError } = await auth.supabase.from("real_estate_leads")
      .select("id,full_name,workspace_id")
      .eq("id", leadId).eq("workspace_id", auth.workspace.id).maybeSingle();
    if (leadError) throw leadError;
    if (!lead) return NextResponse.json({ error: "Lead not found in this workspace." }, { status: 404, headers });

    const service = createRealEstateServiceClient();
    const accessToken = await getRealEstateGoogleCalendarAccessToken(service, auth.workspace.id, googleConnectionId);
    const context = createRealEstateCalendarContext(accessToken);
    const availability = await assertRealEstateCalendarSlotAvailable(
      context, calendarId, start.toISOString(), end.toISOString(),
    );
    if (!availability.available) {
      return NextResponse.json({ error: "The selected time conflicts with an existing Google Calendar event.", code: "INSPECTION_CALENDAR_CONFLICT" }, { status: 409, headers });
    }

    const { data, error } = await service.rpc("reserve_real_estate_inspection_booking", {
      p_workspace_id: auth.workspace.id,
      p_lead_id: leadId,
      p_property_id: propertyId,
      p_agent_id: agentId,
      p_google_connection_id: googleConnectionId,
      p_calendar_id: calendarId,
      p_start_at: start.toISOString(),
      p_end_at: end.toISOString(),
      p_time_zone: timeZone,
      p_idempotency_key: idempotencyKey,
      p_requested_by: auth.user.id,
    });
    if (error) throw error;
    const result = Array.isArray(data) ? data[0] : data;
    if (!result || result.slot_conflict || result.booking_status === "conflict") {
      return NextResponse.json({ error: "That inspection slot was just reserved by another booking. Choose another time.", code: "INSPECTION_SLOT_CONFLICT" }, { status: 409, headers });
    }
    return NextResponse.json({
      success: true,
      bookingId: result.booking_id,
      status: result.booking_status,
      message: "Inspection slot is reserved for agency approval. No calendar event or customer invitation has been created yet.",
    }, { status: 201, headers });
  } catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_]{1,80}$/.test(error.message) ? error.message : "INSPECTION_BOOKING_FAILED";
    if (code.includes("GOOGLE_CALENDAR_CONNECTION") || code.includes("GOOGLE_CALENDAR_SCOPE") || code.includes("GOOGLE_CALENDAR_REAUTH")) {
      return NextResponse.json({ error: "Connect and verify Google Calendar before requesting an inspection.", code }, { status: 409, headers });
    }
    console.error("Real-estate inspection request failed", error);
    return NextResponse.json({ error: "Could not reserve this inspection slot.", code }, { status: 503, headers });
  }
}
