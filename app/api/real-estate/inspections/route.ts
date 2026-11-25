import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
import { hasWorkspacePermission } from "@/lib/supabase/permissions";
import { createRealEstateServiceClient } from "@/lib/real-estate/server";
import { googleAccessToken } from "@/lib/workflows/durable-worker";
import { findOperation } from "@/nodes/registry";
import type { NodeContext } from "@/nodes/types";
import { isProviderLiveEnabled } from "@/lib/workflows/provider-live-gates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
function eventDate(value: unknown): number | null {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const raw = typeof row.dateTime === "string" ? row.dateTime : typeof row.date === "string" ? row.date : null;
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}
async function operationApproved(db: ReturnType<typeof createRealEstateServiceClient>, workspaceId: string, operationId: string) {
  const { data, error } = await db.from("workspace_provider_operation_approvals")
    .select("decision").eq("workspace_id", workspaceId).eq("provider", "google_calendar")
    .eq("node_id", "google_calendar").eq("operation_id", operationId)
    .order("decided_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error("GOOGLE_CALENDAR_APPROVAL_LOOKUP_FAILED");
  return data?.decision === "approved";
}

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json({ error: "Authentication required." }, 401);
    const workspace = await getOrCreateDefaultWorkspace(supabase);
    if (!(await hasWorkspacePermission(supabase, workspace.id, user.id, "operations.view"))) {
      return json({ error: "Workspace operations.view permission required." }, 403);
    }
    const { data, error } = await supabase.from("real_estate_inspection_bookings")
      .select("id,lead_id,property_id,agent_id,google_connection_id,calendar_id,start_at,end_at,time_zone,customer_invite_requested,status,idempotency_key,google_event_id,google_event_url,last_error_code,created_at,approved_at")
      .eq("workspace_id", workspace.id).order("start_at", { ascending: true }).limit(200);
    if (error) throw error;
    const ids = [...new Set((data ?? []).map((row) => row.lead_id))];
    const { data: leads, error: leadsError } = ids.length
      ? await supabase.from("real_estate_leads").select("id,full_name,email,phone").eq("workspace_id", workspace.id).in("id", ids)
      : { data: [], error: null };
    if (leadsError) throw leadsError;
    const leadMap = new Map((leads ?? []).map((lead) => [lead.id, lead]));
    return json({ bookings: (data ?? []).map((row) => ({ ...row, lead: leadMap.get(row.lead_id) ?? null })) });
  } catch (error) {
    console.error("Inspection booking list failed", error);
    return json({ error: "Could not load property inspection bookings." }, 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).origin !== new URL(request.url).origin) return json({ error: "Cross-origin request rejected." }, 403);
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json({ error: "Authentication required." }, 401);
    const workspace = await getOrCreateDefaultWorkspace(supabase);
    if (!(await hasWorkspacePermission(supabase, workspace.id, user.id, "operations.manage"))) {
      return json({ error: "Workspace operations.manage permission required." }, 403);
    }
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > 8192) return json({ error: "Booking request exceeds 8 KB." }, 413);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return json({ error: "Request body must be valid JSON." }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Booking details are required." }, 400);
    const input = body as Record<string, unknown>;
    if (typeof input.leadId !== "string" || !uuid.test(input.leadId) ||
        typeof input.googleConnectionId !== "string" || !uuid.test(input.googleConnectionId) ||
        typeof input.startAt !== "string" || typeof input.endAt !== "string" ||
        typeof input.timeZone !== "string" || typeof input.calendarId !== "string" ||
        typeof input.idempotencyKey !== "string" || input.idempotencyKey.trim().length < 8 || input.idempotencyKey.length > 240) {
      return json({ error: "Choose a lead, verified Calendar, valid time range, time zone and idempotency key." }, 400);
    }
    const start = Date.parse(input.startAt), end = Date.parse(input.endAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start <= Date.now() ||
        end - start < 5 * 60 * 1000 || end - start > 3 * 60 * 60 * 1000 || start > Date.now() + 180 * 24 * 60 * 60 * 1000) {
      return json({ error: "Inspection slots must be 5 minutes to 3 hours, in the next 180 days." }, 400);
    }
    try { new Intl.DateTimeFormat("en-US", { timeZone: input.timeZone }); } catch {
      return json({ error: "Choose a valid IANA time zone." }, 400);
    }
    if (input.calendarId.trim().length < 1 || input.calendarId.length > 300) return json({ error: "Calendar ID is invalid." }, 400);
    if (input.propertyId !== undefined && input.propertyId !== null && (typeof input.propertyId !== "string" || !uuid.test(input.propertyId))) return json({ error: "Property selection is invalid." }, 400);
    if (input.agentId !== undefined && input.agentId !== null && (typeof input.agentId !== "string" || !uuid.test(input.agentId))) return json({ error: "Agent selection is invalid." }, 400);
    const invite = input.sendCustomerInvite === true;

    if (process.env.AIVANTA_LIVE_EXECUTION_ENABLED !== "true" ||
        !isProviderLiveEnabled("google_calendar", process.env.AIVANTA_LIVE_INTEGRATIONS)) {
      return json({ error: "Google Calendar live operations are disabled on this deployment." }, 503);
    }
    const db = createRealEstateServiceClient();
    if (!(await operationApproved(db, workspace.id, "execute"))) {
      return json({ error: "Approve Google Calendar event-read access in workspace operation permissions first." }, 403);
    }
    const [{ data: connection, error: connectionError }, { data: lead, error: leadError }] = await Promise.all([
      db.from("google_connections").select("id,product,status,last_test_status")
        .eq("id", input.googleConnectionId).eq("workspace_id", workspace.id).eq("provider", "google")
        .eq("product", "calendar").eq("status", "connected").eq("last_test_status", "passed").maybeSingle(),
      db.from("real_estate_leads").select("id,full_name,email,consent_to_contact,contact_preference")
        .eq("id", input.leadId).eq("workspace_id", workspace.id).maybeSingle(),
    ]);
    if (connectionError || leadError) throw new Error("INSPECTION_WORKSPACE_LOOKUP_FAILED");
    if (!connection) return json({ error: "Choose a Google Calendar account that is connected and successfully tested in this workspace." }, 409);
    if (!lead) return json({ error: "The selected lead was not found in this workspace." }, 404);
    if (invite && (!lead.email || !lead.consent_to_contact || lead.contact_preference !== "email")) {
      return json({ error: "A customer invite requires recorded email contact consent for this lead." }, 409);
    }

    const accessToken = await googleAccessToken(db as never, workspace.id, "calendar", connection.id);
    const availability = findOperation("google_calendar", "execute", "action");
    if (!availability) throw new Error("GOOGLE_CALENDAR_READ_OPERATION_NOT_REGISTERED");
    const result = await availability.run(nodeContext(accessToken), {
      calendarId: input.calendarId,
      timeMin: new Date(start).toISOString(),
      timeMax: new Date(end).toISOString(),
      maxResults: 100,
    }) as { events?: Array<{ start?: unknown; end?: unknown }> };
    const conflict = (result.events ?? []).some((event) => {
      const eventStart = eventDate(event.start), eventEnd = eventDate(event.end);
      return eventStart !== null && eventEnd !== null && eventStart < end && eventEnd > start;
    });
    if (conflict) return json({ error: "The selected Calendar already has an event during this inspection slot.", code: "INSPECTION_CALENDAR_SLOT_BUSY" }, 409);

    const { data: reserved, error: reserveError } = await db.rpc("reserve_real_estate_inspection_booking", {
      p_workspace_id: workspace.id,
      p_lead_id: lead.id,
      p_property_id: typeof input.propertyId === "string" ? input.propertyId : null,
      p_agent_id: typeof input.agentId === "string" ? input.agentId : null,
      p_google_connection_id: connection.id,
      p_calendar_id: input.calendarId,
      p_start_at: new Date(start).toISOString(),
      p_end_at: new Date(end).toISOString(),
      p_time_zone: input.timeZone,
      p_send_customer_invite: invite,
      p_customer_invite_email: invite ? lead.email : null,
      p_idempotency_key: input.idempotencyKey.trim(),
      p_requested_by: user.id,
    });
    if (reserveError) {
      if (reserveError.code === "23505") return json({ error: "This idempotency key was already used for different booking details." }, 409);
      if (reserveError.code === "42501") return json({ error: "Customer email consent is required before sending a Calendar invitation." }, 403);
      if (reserveError.code === "P0002") return json({ error: "A selected lead, property, agent or Calendar connection is no longer available." }, 409);
      if (reserveError.code === "22023") return json({ error: "The inspection booking details are invalid." }, 400);
      throw reserveError;
    }
    const row = Array.isArray(reserved) ? reserved[0] : reserved;
    if (!row?.booking_id) {
      return json({ error: row?.slot_conflict ? "The slot is already reserved by another Rexnora booking." : "The booking could not be reserved." }, 409);
    }
    const { data: booking, error: bookingError } = await db.from("real_estate_inspection_bookings")
      .select("id,status,start_at,end_at,time_zone,calendar_id,customer_invite_requested")
      .eq("id", row.booking_id).eq("workspace_id", workspace.id).single();
    if (bookingError) throw bookingError;
    return json({ booking, message: "Inspection slot reserved. An agency owner or admin must approve Calendar event creation." }, 201);
  } catch (error) {
    console.error("Inspection booking request failed", error);
    return json({ error: "Could not reserve this inspection slot. Verify the Calendar connection and try again." }, 500);
  }
}
