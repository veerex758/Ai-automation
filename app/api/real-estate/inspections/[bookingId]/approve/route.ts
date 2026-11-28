import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
import { createRealEstateServiceClient } from "@/lib/real-estate/server";
import { googleAccessToken } from "@/lib/workflows/durable-worker";
import { findOperation } from "@/nodes/registry";
import type { NodeContext } from "@/nodes/types";
import { isProviderLiveEnabled } from "@/lib/workflows/provider-live-gates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Context = { params: Promise<{ bookingId: string }> };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers });
}
function nodeContext(accessToken: string): NodeContext {
  return {
    credentials: { google_calendar: { accessToken } },
    previousOutputs: {},
    logger: {
      info(message, meta) { console.info("[real-estate-inspections]", message, meta ?? {}); },
      error(message, meta) { console.error("[real-estate-inspections]", message, meta ?? {}); },
    },
    http: {
      async request(args) {
        const response = await fetch(args.url, {
          method: args.method,
          headers: args.headers,
          body: args.body === undefined ? undefined : JSON.stringify(args.body),
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(Math.min(20000, Math.max(1000, args.timeoutMs ?? 15000))),
        });
        const raw = await response.text();
        let body: unknown;
        try { body = raw ? JSON.parse(raw) : {}; } catch { body = raw; }
        return { status: response.status, body };
      },
    },
  };
}

export async function POST(request: NextRequest, context: Context) {
  let db: ReturnType<typeof createRealEstateServiceClient> | null = null;
  let bookingId: string | null = null;
  let workspaceId: string | null = null;
  try {
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).origin !== new URL(request.url).origin) return json({ error: "Cross-origin request rejected." }, 403);
    const { bookingId: requestedId } = await context.params;
    if (!uuid.test(requestedId)) return json({ error: "Invalid booking ID." }, 400);
    bookingId = requestedId;

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json({ error: "Authentication required." }, 401);
    const workspace = await getOrCreateDefaultWorkspace(supabase);
    workspaceId = workspace.id;
    const { data: workspaceRow, error: workspaceError } = await supabase.from("workspaces")
      .select("owner_id").eq("id", workspace.id).maybeSingle();
    const { data: membership, error: membershipError } = await supabase.from("workspace_members")
      .select("role").eq("workspace_id", workspace.id).eq("user_id", user.id).maybeSingle();
    if (workspaceError || membershipError) throw new Error("INSPECTION_APPROVER_LOOKUP_FAILED");
    if (workspaceRow?.owner_id !== user.id && !["owner", "admin"].includes(membership?.role ?? "")) {
      return json({ error: "Only workspace owners and admins can approve Calendar event creation." }, 403);
    }

    if (process.env.AIVANTA_LIVE_EXECUTION_ENABLED !== "true" ||
        process.env.REAL_ESTATE_INSPECTIONS_ENABLED !== "true" ||
        !isProviderLiveEnabled("google_calendar", process.env.AIVANTA_LIVE_INTEGRATIONS)) {
      return json({ error: "Live inspection event creation is disabled on this deployment." }, 503);
    }
    db = createRealEstateServiceClient();
    const { data: approval, error: approvalError } = await db.from("workspace_provider_operation_approvals")
      .select("decision").eq("workspace_id", workspace.id).eq("provider", "google_calendar")
      .eq("node_id", "google_calendar").eq("operation_id", "create_event")
      .order("decided_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle();
    if (approvalError) throw new Error("GOOGLE_CALENDAR_APPROVAL_LOOKUP_FAILED");
    if (approval?.decision !== "approved") {
      return json({ error: "Approve Google Calendar / create_event in workspace operation permissions before creating events." }, 403);
    }

    const { data: booking, error: bookingError } = await db.from("real_estate_inspection_bookings")
      .select("id,workspace_id,lead_id,property_id,agent_id,google_connection_id,calendar_id,start_at,end_at,time_zone,customer_invite_requested,customer_invite_email,status")
      .eq("id", bookingId).eq("workspace_id", workspace.id).maybeSingle();
    if (bookingError) throw new Error("INSPECTION_BOOKING_LOOKUP_FAILED");
    if (!booking) return json({ error: "Booking not found in this workspace." }, 404);
    if (!["requested", "unknown", "creating"].includes(booking.status)) {
      if (booking.status === "confirmed") return json({ success: true, bookingId, status: "confirmed", eventUrl: null, alreadyConfirmed: true });
      return json({ error: "This booking cannot be approved from its current state.", status: booking.status }, 409);
    }
    const { data: lead, error: leadError } = await db.from("real_estate_leads")
      .select("id,full_name,email,consent_to_contact,contact_preference")
      .eq("id", booking.lead_id).eq("workspace_id", workspace.id).maybeSingle();
    if (leadError) throw new Error("INSPECTION_LEAD_LOOKUP_FAILED");
    if (!lead) return json({ error: "The customer lead no longer exists." }, 409);
    if (booking.customer_invite_requested && (
      !lead.email || !lead.consent_to_contact || lead.contact_preference !== "email" ||
      lead.email.toLowerCase() !== String(booking.customer_invite_email ?? "").toLowerCase()
    )) return json({ error: "The recorded email consent no longer permits a Calendar invitation." }, 409);

    const { data: begun, error: beginError } = await db.rpc("begin_real_estate_inspection_booking", {
      p_workspace_id: workspace.id, p_booking_id: bookingId, p_approved_by: user.id,
    });
    if (beginError) throw new Error("INSPECTION_BOOKING_APPROVAL_FAILED");
    const begin = Array.isArray(begun) ? begun[0] : begun;
    if (begin?.result_status === "in_progress") return json({ status: "in_progress", bookingId }, 202);
    if (begin?.result_status === "conflict") return json({ error: "This inspection slot conflicts with another Rexnora booking." }, 409);
    if (begin?.result_status !== "creating") {
      return json({ error: "This booking cannot be approved.", status: begin?.result_status ?? "not_found" }, 409);
    }

    const accessToken = await googleAccessToken(db as never, workspace.id, "calendar", booking.google_connection_id);
    const operation = findOperation("google_calendar", "create_event", "action");
    if (!operation) throw new Error("GOOGLE_CALENDAR_CREATE_OPERATION_NOT_REGISTERED");
    const eventId = booking.id.replaceAll("-", "").toLowerCase();
    const invite = booking.customer_invite_requested === true;
    const event = await operation.run(nodeContext(accessToken), {
      calendarId: booking.calendar_id,
      eventId,
      summary: "Property inspection · " + lead.full_name,
      description: "Inspection arranged through Rexnora. Booking reference: " + booking.id,
      startDateTime: new Date(booking.start_at).toISOString(),
      endDateTime: new Date(booking.end_at).toISOString(),
      timeZone: booking.time_zone,
      ...(invite && booking.customer_invite_email ? { attendeeEmails: [booking.customer_invite_email] } : {}),
      sendUpdates: invite ? "all" : "none",
    }) as { id?: string; htmlLink?: string };
    if (typeof event?.id !== "string" || event.id !== eventId) throw new Error("GOOGLE_CALENDAR_EVENT_ID_MISMATCH");

    const dueAt = new Date(Math.max(Date.now(), Date.parse(booking.start_at) - 60 * 60 * 1000)).toISOString();
    const { error: taskError } = await db.from("real_estate_tasks").upsert({
      workspace_id: workspace.id, lead_id: lead.id, assigned_agent_id: booking.agent_id,
      task_type: "inspection_preparation", title: "Prepare for property inspection",
      description: "Confirm access, property readiness and customer arrangements for the scheduled inspection.",
      status: "open", priority: "high", due_at: dueAt,
      idempotency_key: "inspection:" + bookingId + ":preparation:v1", created_by: user.id,
    }, { onConflict: "workspace_id,idempotency_key", ignoreDuplicates: true });
    if (taskError) throw new Error("INSPECTION_PREPARATION_TASK_FAILED");

    const now = new Date().toISOString();
    const { error: confirmedError } = await db.from("real_estate_inspection_bookings").update({
      status: "confirmed", google_event_id: event.id, google_event_url: event.htmlLink ?? null,
      last_error_code: null, updated_at: now,
    }).eq("id", bookingId).eq("workspace_id", workspace.id).in("status", ["creating", "unknown"]);
    if (confirmedError) throw new Error("INSPECTION_BOOKING_CONFIRM_FAILED");
    await db.from("real_estate_lead_activities").insert({
      workspace_id: workspace.id, lead_id: lead.id, actor_user_id: user.id,
      activity_type: "lead.inspection_booking_confirmed",
      details: { bookingId, googleEventId: event.id, customerInviteSent: invite },
    });
    return json({ success: true, bookingId, status: "confirmed", eventId: event.id, eventUrl: event.htmlLink ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const code = /^[A-Z0-9_]{1,80}$/.test(message) ? message : "INSPECTION_EVENT_CREATE_FAILED";
    if (db && bookingId && workspaceId) {
      const uncertain = /NETWORK|TIMEOUT|ABORT|FETCH|HTTP_5/.test(code) || !/GOOGLE_CALENDAR_HTTP_4/.test(code);
      await db.from("real_estate_inspection_bookings").update({
        status: uncertain ? "unknown" : "failed", last_error_code: code, updated_at: new Date().toISOString(),
      }).eq("id", bookingId).eq("workspace_id", workspaceId).eq("status", "creating");
    }
    console.error("Inspection event approval failed", { bookingId, code });
    return json({ error: "Google Calendar event creation did not complete. The booking was left recoverable; retry will reconcile the same event ID." }, 503);
  }
}
