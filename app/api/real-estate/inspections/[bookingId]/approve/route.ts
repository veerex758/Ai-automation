import { createHash } from "node:crypto";
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
import { findOperation } from "@/nodes/registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Booking = {
  id: string;
  workspace_id: string;
  lead_id: string;
  property_id: string | null;
  google_connection_id: string;
  calendar_id: string;
  start_at: string;
  end_at: string;
  time_zone: string;
  status: string;
  google_event_id: string | null;
};

function deterministicGoogleEventId(workspaceId: string, bookingId: string) {
  // Google event IDs accept lower-case base32hex characters. Hex is a valid subset.
  return createHash("sha256").update("rexnora-inspection:" + workspaceId + ":" + bookingId)
    .digest("hex").slice(0, 40);
}

function eventMatches(event: { start?: unknown; end?: unknown }, booking: Booking) {
  const start = event.start && typeof event.start === "object" ? event.start as Record<string, unknown> : {};
  const end = event.end && typeof event.end === "object" ? event.end as Record<string, unknown> : {};
  const startValue = typeof start.dateTime === "string" ? start.dateTime : typeof start.date === "string" ? start.date : null;
  const endValue = typeof end.dateTime === "string" ? end.dateTime : typeof end.date === "string" ? end.date : null;
  if (!startValue || !endValue) return false;
  return Math.abs(Date.parse(startValue) - Date.parse(booking.start_at)) < 1000 &&
    Math.abs(Date.parse(endValue) - Date.parse(booking.end_at)) < 1000;
}

export async function POST(_request: NextRequest, context: { params: Promise<{ bookingId: string }> }) {
  let booking: Booking | null = null;
  const service = createRealEstateServiceClient();
  try {
    const { bookingId } = await context.params;
    if (!uuid.test(bookingId)) return NextResponse.json({ error: "Invalid inspection booking ID." }, { status: 400, headers });
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers });
    const workspace = await getOrCreateDefaultWorkspace(supabase);
    if (!await hasWorkspacePermission(supabase, workspace.id, user.id, "workflows.execute")) {
      return NextResponse.json({ error: "Workspace workflows.execute permission is required to approve inspections." }, { status: 403, headers });
    }
    const { data, error } = await supabase.from("real_estate_inspection_bookings")
      .select("id,workspace_id,lead_id,property_id,google_connection_id,calendar_id,start_at,end_at,time_zone,status,google_event_id")
      .eq("id", bookingId).eq("workspace_id", workspace.id).maybeSingle();
    if (error) throw error;
    booking = data as Booking | null;
    if (!booking) return NextResponse.json({ error: "Inspection booking not found in this workspace." }, { status: 404, headers });
    if (booking.status === "confirmed" && booking.google_event_id) {
      return NextResponse.json({ success: true, bookingId, status: "confirmed", eventId: booking.google_event_id, reconciled: true }, { headers });
    }
    if (!["requested", "creating", "unknown"].includes(booking.status)) {
      return NextResponse.json({ error: "This inspection booking cannot be approved from its current state.", status: booking.status }, { status: 409, headers });
    }

    const accessToken = await getRealEstateGoogleCalendarAccessToken(service, workspace.id, booking.google_connection_id);
    const calendarContext = createRealEstateCalendarContext(accessToken);
    const eventId = deterministicGoogleEventId(workspace.id, booking.id);

    // First reconcile any previous uncertain create against the deterministic Google event ID.
    const getEvent = findOperation("google_calendar", "get_event", "action");
    const createEvent = findOperation("google_calendar", "create_event", "action");
    if (!getEvent || !createEvent) throw new Error("GOOGLE_CALENDAR_BOOKING_OPERATIONS_NOT_REGISTERED");
    let existingEvent: Record<string, unknown> | null = null;
    try {
      existingEvent = await getEvent.run(calendarContext, { calendarId: booking.calendar_id, eventId }) as Record<string, unknown>;
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      if (code !== "GOOGLE_CALENDAR_EVENT_NOT_FOUND") {
        throw new Error("GOOGLE_CALENDAR_RECONCILIATION_FAILED");
      }
    }

    if (existingEvent) {
      if (!eventMatches(existingEvent as { start?: unknown; end?: unknown }, booking)) {
        await service.from("real_estate_inspection_bookings").update({
          status: "unknown", last_error_code: "GOOGLE_EVENT_ID_CONFLICT", updated_at: new Date().toISOString(),
        }).eq("id", booking.id).eq("workspace_id", workspace.id);
        return NextResponse.json({ error: "A Google event exists with the booking ID but its times do not match. Manual reconciliation is required.", code: "GOOGLE_EVENT_ID_CONFLICT" }, { status: 409, headers });
      }
      const { error: reconcileError } = await service.from("real_estate_inspection_bookings").update({
        status: "confirmed",
        google_event_id: eventId,
        google_event_url: typeof existingEvent.htmlLink === "string" ? existingEvent.htmlLink : null,
        last_error_code: null,
        updated_at: new Date().toISOString(),
      }).eq("id", booking.id).eq("workspace_id", workspace.id).in("status", ["creating", "unknown", "requested"]);
      if (reconcileError) throw new Error("INSPECTION_RECONCILIATION_WRITE_FAILED");
      return NextResponse.json({ success: true, bookingId, status: "confirmed", eventId, reconciled: true }, { headers });
    }

    if (booking.status === "requested") {
      const { data: begun, error: beginError } = await service.rpc("begin_real_estate_inspection_booking", {
        p_workspace_id: workspace.id,
        p_booking_id: booking.id,
        p_approved_by: user.id,
      });
      if (beginError) throw beginError;
      const result = Array.isArray(begun) ? begun[0] : begun;
      if (!result || result.result_status !== "creating") {
        return NextResponse.json({ error: "Inspection approval could not acquire this reserved slot.", status: result?.result_status ?? "unknown" }, { status: 409, headers });
      }
      booking = { ...booking, status: "creating" };
    }

    const availability = await assertRealEstateCalendarSlotAvailable(
      calendarContext, booking.calendar_id, booking.start_at, booking.end_at, eventId,
    );
    if (!availability.available) {
      await service.from("real_estate_inspection_bookings").update({
        status: "failed", last_error_code: "INSPECTION_SLOT_CONFLICT", updated_at: new Date().toISOString(),
      }).eq("id", booking.id).eq("workspace_id", workspace.id).eq("status", "creating");
      return NextResponse.json({ error: "The Google Calendar slot is no longer available. The booking was not created.", code: "INSPECTION_SLOT_CONFLICT" }, { status: 409, headers });
    }

    const [{ data: lead, error: leadError }, propertyResult] = await Promise.all([
      service.from("real_estate_leads").select("full_name").eq("id", booking.lead_id).eq("workspace_id", workspace.id).maybeSingle(),
      booking.property_id
        ? service.from("real_estate_properties").select("title,location,address,reference").eq("id", booking.property_id).eq("workspace_id", workspace.id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (leadError || propertyResult.error) throw new Error("INSPECTION_BOOKING_DETAILS_UNAVAILABLE");
    const property = propertyResult.data;
    const summary = "Property inspection · " + (property?.reference || property?.title || booking.id.slice(0, 8));
    const description = [
      "Rexnora inspection booking " + booking.id,
      "Customer: " + (lead?.full_name ?? "Property enquiry"),
      "Property: " + (property?.title ?? "Agency property"),
    ].join("\n");

    try {
      const created = await createEvent.run(calendarContext, {
        calendarId: booking.calendar_id,
        eventId,
        summary,
        description,
        location: property?.address || property?.location || undefined,
        startDateTime: new Date(booking.start_at).toISOString(),
        endDateTime: new Date(booking.end_at).toISOString(),
        timeZone: booking.time_zone,
        sendUpdates: "none",
      }) as { id?: string; htmlLink?: string };
      if (created.id !== eventId) throw new Error("GOOGLE_CALENDAR_CREATED_EVENT_ID_MISMATCH");
      const { error: saveError } = await service.from("real_estate_inspection_bookings").update({
        status: "confirmed",
        google_event_id: created.id,
        google_event_url: created.htmlLink ?? null,
        last_error_code: null,
        updated_at: new Date().toISOString(),
      }).eq("id", booking.id).eq("workspace_id", workspace.id).eq("status", "creating");
      if (saveError) throw new Error("INSPECTION_BOOKING_CONFIRM_WRITE_FAILED");
      await service.from("real_estate_lead_activities").insert({
        workspace_id: workspace.id, lead_id: booking.lead_id, actor_user_id: user.id,
        activity_type: "lead.inspection_booked",
        details: { bookingId: booking.id, eventId: created.id, startAt: booking.start_at, endAt: booking.end_at },
      });
      return NextResponse.json({ success: true, bookingId, status: "confirmed", eventId: created.id, eventUrl: created.htmlLink ?? null }, { headers });
    } catch (cause) {
      const code = cause instanceof Error && /^[A-Z0-9_]{1,80}$/.test(cause.message)
        ? cause.message : "GOOGLE_CALENDAR_CREATE_UNCERTAIN";
      // Never blindly repeat a timed-out event creation. A later approval call
      // first GETs the same deterministic event ID and reconciles it if present.
      await service.from("real_estate_inspection_bookings").update({
        status: "unknown", last_error_code: code, updated_at: new Date().toISOString(),
      }).eq("id", booking.id).eq("workspace_id", workspace.id).eq("status", "creating");
      return NextResponse.json({ error: "Google Calendar did not confirm the event. The booking is held for reconciliation and will not be duplicated.", code }, { status: 503, headers });
    }
  } catch (error) {
    console.error("Real-estate inspection approval failed", error);
    return NextResponse.json({ error: "Could not approve this inspection booking. No customer invitation was sent.", code: "INSPECTION_APPROVAL_FAILED" }, { status: 503, headers });
  }
}
