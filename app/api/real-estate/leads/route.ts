import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
import { scoreRealEstateLead } from "@/lib/real-estate/lead-scoring";
import { createFollowupRows, createRealEstateServiceClient } from "@/lib/real-estate/server";
import { processRealEstateLeadPipeline } from "@/lib/real-estate/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const allowed = <T extends string>(value: unknown, values: readonly T[], fallback: T): T => values.includes(value as T) ? value as T : fallback;
const text = (value: unknown, max: number) => typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
type ManualLeadRecord = { id: string; workspace_id: string; source: string; full_name: string; email: string | null; preferred_location: string | null; property_type: string; transaction_type: string; lead_score: number; lead_temperature: string; created_at: string; consent_to_contact: boolean; consent_text: string | null; consent_at: string | null; contact_preference: string };

function parseLead(body: Record<string, unknown>) {
  const fullName = text(body.fullName, 160);
  const email = text(body.email, 254)?.toLowerCase() ?? null;
  const phone = text(body.phone, 40);
  if (!fullName) throw new Error("A customer name is required.");
  if (!email && !phone) throw new Error("Provide at least an email address or phone number.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Provide a valid email address.");
  if (typeof body.consentToContact !== "boolean") throw new Error("Explicit customer contact consent must be recorded.");
  const contactPreference = allowed(body.contactPreference, ["email","phone","whatsapp"] as const, "email");
  const consentText = text(body.consentText, 1000);
  if (body.consentToContact && (!consentText || (contactPreference === "whatsapp" && !/whatsapp/i.test(consentText)))) {
    throw new Error(contactPreference === "whatsapp"
      ? "Record the customer's explicit WhatsApp consent text before selecting WhatsApp contact."
      : "Record the customer's consent text before enabling follow-up contact.");
  }
  const budgetMin = body.budgetMin === null || body.budgetMin === undefined || body.budgetMin === "" ? null : Number(body.budgetMin);
  const budgetMax = body.budgetMax === null || body.budgetMax === undefined || body.budgetMax === "" ? null : Number(body.budgetMax);
  if ((budgetMin !== null && (!Number.isFinite(budgetMin) || budgetMin < 0)) || (budgetMax !== null && (!Number.isFinite(budgetMax) || budgetMax < 0)) || (budgetMin !== null && budgetMax !== null && budgetMax < budgetMin) || budgetMin !== null && budgetMin > 1e12 || budgetMax !== null && budgetMax > 1e12) {
    throw new Error("Budget values must be valid non-negative amounts and the maximum cannot be below the minimum.");
  }
  const currency = (text(body.currency, 3) ?? "USD").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Currency must be a three-letter ISO code.");
  const bedrooms = body.bedrooms === null || body.bedrooms === undefined || body.bedrooms === "" ? null : Number(body.bedrooms);
  if (bedrooms !== null && (!Number.isInteger(bedrooms) || bedrooms < 0 || bedrooms > 50)) throw new Error("Bedrooms must be a whole number between 0 and 50.");
  return {
    source: text(body.source, 80) ?? "manual",
    source_event_id: text(body.sourceEventId, 200),
    full_name: fullName, email, phone,
    transaction_type: allowed(body.transactionType, ["buy","rent","invest","sell","unknown"] as const, "unknown"),
    property_type: allowed(body.propertyType, ["apartment","house","land","commercial","other","unknown"] as const, "unknown"),
    preferred_location: text(body.preferredLocation, 200),
    budget_min: budgetMin, budget_max: budgetMax, currency,
    bedrooms,
    timeframe: allowed(body.timeframe, ["urgent","within_30_days","one_to_three_months","over_three_months","unknown"] as const, "unknown"),
    readiness: allowed(body.readiness, ["cash_ready","pre_approved","financing_needed","researching","unknown"] as const, "unknown"),
    financing_notes: text(body.financingNotes, 500), main_concern: text(body.mainConcern, 500),
    contact_preference: contactPreference,
    consent_to_contact: body.consentToContact,
    consent_text: body.consentToContact ? consentText : null,
    consent_at: body.consentToContact ? new Date().toISOString() : null,
    status: "new",
    raw_enquiry: isRecord(body.rawEnquiry) ? body.rawEnquiry : {},
  };
}


async function ensureLeadSideEffects(
  supabase: Awaited<ReturnType<typeof createClient>>,
  lead: ManualLeadRecord,
  workspaceId: string,
  userId: string,
) {
  const { data: activity, error: activityLookupError } = await supabase.from("real_estate_lead_activities")
    .select("id").eq("workspace_id", workspaceId).eq("lead_id", lead.id).eq("activity_type", "lead.created").limit(1).maybeSingle();
  if (activityLookupError) throw activityLookupError;
  if (!activity) {
    const { error } = await supabase.from("real_estate_lead_activities").insert({
      workspace_id: workspaceId, lead_id: lead.id, actor_user_id: userId,
      activity_type: "lead.created",
      details: { source: lead.source, score: lead.lead_score, temperature: lead.lead_temperature },
    });
    if (error) throw error;
  }

  if (!lead.consent_to_contact || !lead.consent_at || !lead.consent_text || lead.contact_preference !== "email" || !lead.email) return 0;
  // Follow-up queue rows are deliberately read-only to workspace members.
  // Use the server-only service client after this route has authenticated the member
  // and resolved the lead in their workspace.
  const service = createRealEstateServiceClient();
  const rows = createFollowupRows(lead as Parameters<typeof createFollowupRows>[0], new Date(lead.created_at));
  const { error: queueError } = await service.from("real_estate_followups")
    .upsert(rows, { onConflict: "lead_id,sequence", ignoreDuplicates: true });
  if (queueError) throw queueError;
  return rows.length;
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
    let query = supabase.from("real_estate_leads").select("id,source,full_name,email,phone,transaction_type,property_type,preferred_location,budget_min,budget_max,currency,timeframe,readiness,lead_score,score_factors,lead_temperature,status,assigned_agent_id,consent_to_contact,contact_preference,customer_responded_at,agent_takeover_at,created_at,updated_at", { count: "exact" })
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
      const { data: prior, error: priorError } = await supabase.from("real_estate_leads").select("*")
        .eq("workspace_id", workspace.id).eq("source", lead.source).eq("source_event_id", lead.source_event_id).maybeSingle();
      if (priorError) throw priorError;
      if (prior) {
        await ensureLeadSideEffects(supabase, prior, workspace.id, user.id);
        let pipeline={enabled:false,claimed:0,completed:0,blocked:0,failed:0};
        try{pipeline=await processRealEstateLeadPipeline({db:createRealEstateServiceClient(),workspaceId:workspace.id,leadId:prior.id});}
        catch(pipelineError){console.error("Duplicate manual lead pipeline recovery failed",pipelineError);}
        return NextResponse.json({ lead: prior, duplicate: true, pipeline }, { status: 200, headers });
      }
    }

    const { data: activePlaybooks, error: activePlaybookError } = await supabase.from("workflows")
      .select("id,version").eq("workspace_id", workspace.id).eq("status", "active")
      .contains("definition", { playbook: { schema: "rexnora.playbook", schemaVersion: 1 } }).limit(2);
    if (activePlaybookError) throw activePlaybookError;
    if ((activePlaybooks ?? []).length > 1) throw new Error("MULTIPLE_ACTIVE_PLAYBOOKS_FOR_WORKSPACE");
    const activePlaybook = activePlaybooks?.[0] ?? null;

    const score = scoreRealEstateLead({
      transactionType: lead.transaction_type, propertyType: lead.property_type,
      preferredLocation: lead.preferred_location, budgetMin: lead.budget_min, budgetMax: lead.budget_max,
      timeframe: lead.timeframe, readiness: lead.readiness, email: lead.email, phone: lead.phone,
    });
    const { data: created, error } = await supabase.from("real_estate_leads").insert({
      ...lead, workspace_id: workspace.id, created_by: user.id,
      workflow_id: activePlaybook?.id ?? null,
      playbook_version: activePlaybook?.version ?? null,
      lead_score: score.score, lead_temperature: score.temperature, score_factors: score.factors,
    }).select("*").single();
    if (error?.code === "23505" && lead.source_event_id) {
      const { data: prior } = await supabase.from("real_estate_leads").select("*").eq("workspace_id", workspace.id).eq("source", lead.source).eq("source_event_id", lead.source_event_id).maybeSingle();
      if (prior) {
        await ensureLeadSideEffects(supabase, prior, workspace.id, user.id);
        let pipeline={enabled:false,claimed:0,completed:0,blocked:0,failed:0};
        try{pipeline=await processRealEstateLeadPipeline({db:createRealEstateServiceClient(),workspaceId:workspace.id,leadId:prior.id});}
        catch(pipelineError){console.error("Racing manual lead pipeline recovery failed",pipelineError);}
        return NextResponse.json({ lead: prior, duplicate: true, pipeline }, { status: 200, headers });
      }
    }
    if (error) throw error;

    const followupsCreated = await ensureLeadSideEffects(supabase, created, workspace.id, user.id);
    let pipeline={enabled:false,claimed:0,completed:0,blocked:0,failed:0};
    try{pipeline=await processRealEstateLeadPipeline({db:createRealEstateServiceClient(),workspaceId:workspace.id,leadId:created.id});}
    catch(pipelineError){console.error("New manual lead pipeline queued for recovery",pipelineError);}
    return NextResponse.json({ lead: created, score, followupsCreated, pipeline }, { status: 201, headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/required|valid|consent|Budget|Currency|three-letter/.test(message)) return NextResponse.json({ error: message }, { status: 400, headers });
    console.error("Real-estate lead create failed", error);
    return NextResponse.json({ error: "Could not create this lead." }, { status: 500, headers });
  }
}
