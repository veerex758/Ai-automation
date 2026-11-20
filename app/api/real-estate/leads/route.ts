import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
import { scoreRealEstateLead } from "@/lib/real-estate/lead-scoring";
import { createFollowupRows } from "@/lib/real-estate/server";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const allowed = <T extends string>(value: unknown, values: readonly T[], fallback: T): T => values.includes(value as T) ? value as T : fallback;
const text = (value: unknown, max: number) => typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;

function parseLead(body: Record<string, unknown>) {
  const fullName = text(body.fullName, 160);
  const email = text(body.email, 254)?.toLowerCase() ?? null;
  const phone = text(body.phone, 40);
  if (!fullName) throw new Error("A customer name is required.");
  if (!email && !phone) throw new Error("Provide at least an email address or phone number.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Provide a valid email address.");
  if (typeof body.consentToContact !== "boolean") throw new Error("Explicit customer contact consent must be recorded.");
  const budgetMin = body.budgetMin === null || body.budgetMin === undefined || body.budgetMin === "" ? null : Number(body.budgetMin);
  const budgetMax = body.budgetMax === null || body.budgetMax === undefined || body.budgetMax === "" ? null : Number(body.budgetMax);
  if ((budgetMin !== null && (!Number.isFinite(budgetMin) || budgetMin < 0)) || (budgetMax !== null && (!Number.isFinite(budgetMax) || budgetMax < 0)) || (budgetMin !== null && budgetMax !== null && budgetMax < budgetMin) || budgetMin !== null && budgetMin > 1e12 || budgetMax !== null && budgetMax > 1e12) {
    throw new Error("Budget values must be valid non-negative amounts and the maximum cannot be below the minimum.");
  }
  const currency = (text(body.currency, 3) ?? "USD").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Currency must be a three-letter ISO code.");
  return {
    source: text(body.source, 80) ?? "manual",
    source_event_id: text(body.sourceEventId, 200),
    full_name: fullName, email, phone,
    transaction_type: allowed(body.transactionType, ["buy","rent","invest","sell","unknown"] as const, "unknown"),
    property_type: allowed(body.propertyType, ["apartment","house","land","commercial","other","unknown"] as const, "unknown"),
    preferred_location: text(body.preferredLocation, 200),
    budget_min: budgetMin, budget_max: budgetMax, currency,
    bedrooms: body.bedrooms === null || body.bedrooms === undefined || body.bedrooms === "" ? null : Number(body.bedrooms),
    timeframe: allowed(body.timeframe, ["urgent","within_30_days","one_to_three_months","over_three_months","unknown"] as const, "unknown"),
    readiness: allowed(body.readiness, ["cash_ready","pre_approved","financing_needed","researching","unknown"] as const, "unknown"),
    financing_notes: text(body.financingNotes, 500), main_concern: text(body.mainConcern, 500),
    contact_preference: allowed(body.contactPreference, ["email","phone","whatsapp"] as const, "email"),
    consent_to_contact: body.consentToContact,
    consent_text: text(body.consentText, 1000),
    consent_at: body.consentToContact ? new Date().toISOString() : null,
    status: "new",
    raw_enquiry: isRecord(body.rawEnquiry) ? body.rawEnquiry : {},
  };
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers });
    const workspace = await getOrCreateDefaultWorkspace(supabase);
    const params = request.nextUrl.searchParams;
    const status = params.get("status");
    const search = (params.get("q") ?? "").trim().slice(0, 100);
    const limit = Math.max(1, Math.min(100, Number(params.get("limit") ?? 50) || 50));
    const offset = Math.max(0, Math.min(100000, Number(params.get("offset") ?? 0) || 0));
    let query = supabase.from("real_estate_leads").select("id,source,full_name,email,phone,transaction_type,property_type,preferred_location,budget_min,budget_max,currency,timeframe,readiness,lead_score,score_factors,lead_temperature,status,assigned_agent_id,consent_to_contact,customer_responded_at,agent_takeover_at,created_at,updated_at", { count: "exact" })
      .eq("workspace_id", workspace.id).order("lead_score", { ascending: false }).order("created_at", { ascending: false }).range(offset, offset + limit - 1);
    if (status && ["new","qualified","contacted","viewing_scheduled","negotiation","won","lost"].includes(status)) query = query.eq("status", status);
    if (search) query = query.ilike("full_name", "%" + search.replace(/[%_]/g, "\\$&") + "%");
    const { data, error, count } = await query;
    if (error) throw error;
    return NextResponse.json({ leads: data ?? [], total: count ?? 0, limit, offset, workspaceId: workspace.id }, { headers });
  } catch (error) {
    console.error("Real-estate lead list failed", error);
    return NextResponse.json({ error: "Could not load real-estate leads." }, { status: 500, headers });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers });
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > 20000) return NextResponse.json({ error: "Lead input exceeds 20 KiB." }, { status: 413, headers });
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400, headers }); }
    if (!isRecord(body)) return NextResponse.json({ error: "Lead input must be a JSON object." }, { status: 400, headers });
    const lead = parseLead(body);
    const workspace = await getOrCreateDefaultWorkspace(supabase);

    if (lead.source_event_id) {
      const { data: prior, error: priorError } = await supabase.from("real_estate_leads").select("id,full_name,lead_score,lead_temperature,status,created_at")
        .eq("workspace_id", workspace.id).eq("source", lead.source).eq("source_event_id", lead.source_event_id).maybeSingle();
      if (priorError) throw priorError;
      if (prior) return NextResponse.json({ lead: prior, duplicate: true }, { status: 200, headers });
    }

    const score = scoreRealEstateLead({
      transactionType: lead.transaction_type, propertyType: lead.property_type,
      preferredLocation: lead.preferred_location, budgetMin: lead.budget_min, budgetMax: lead.budget_max,
      timeframe: lead.timeframe, readiness: lead.readiness, email: lead.email, phone: lead.phone,
    });
    const { data: created, error } = await supabase.from("real_estate_leads").insert({
      ...lead, workspace_id: workspace.id, created_by: user.id,
      lead_score: score.score, lead_temperature: score.temperature, score_factors: score.factors,
    }).select("*").single();
    if (error?.code === "23505" && lead.source_event_id) {
      const { data: prior } = await supabase.from("real_estate_leads").select("id,full_name,lead_score,status").eq("workspace_id", workspace.id).eq("source", lead.source).eq("source_event_id", lead.source_event_id).maybeSingle();
      if (prior) return NextResponse.json({ lead: prior, duplicate: true }, { status: 200, headers });
    }
    if (error) throw error;

    const { error: activityError } = await supabase.from("real_estate_lead_activities").insert({
      workspace_id: workspace.id, lead_id: created.id, actor_user_id: user.id,
      activity_type: "lead.created", details: { source: lead.source, score: score.score, temperature: score.temperature },
    });
    if (activityError) throw activityError;

    let followupsCreated = 0;
    if (created.consent_to_contact && created.contact_preference === "email" && created.email) {
      const { error: followupError } = await supabase.from("real_estate_followups").insert(
        createFollowupRows(created, new Date(created.created_at)),
      );
      if (followupError) throw followupError;
      followupsCreated = 5;
    }
    return NextResponse.json({ lead: created, score, followupsCreated }, { status: 201, headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/required|valid|consent|Budget|Currency|three-letter/.test(message)) return NextResponse.json({ error: message }, { status: 400, headers });
    console.error("Real-estate lead create failed", error);
    return NextResponse.json({ error: "Could not create this lead." }, { status: 500, headers });
  }
}
