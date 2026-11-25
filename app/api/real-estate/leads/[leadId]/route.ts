import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
import { scoreRealEstateLead } from "@/lib/real-estate/lead-scoring";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedStatuses = ["new","qualified","contacted","viewing_scheduled","negotiation","won","lost"];
type Context = { params: Promise<{ leadId: string }> };

export async function GET(_request: NextRequest, context: Context) {
  try {
    const { leadId } = await context.params;
    if (!uuid.test(leadId)) return NextResponse.json({ error: "Invalid lead ID." }, { status: 400, headers });
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers });
    const workspace = await getOrCreateDefaultWorkspace(supabase);
    const { data: lead, error } = await supabase.from("real_estate_leads").select("*").eq("id", leadId).eq("workspace_id", workspace.id).maybeSingle();
    if (error) throw error;
    if (!lead) return NextResponse.json({ error: "Lead not found." }, { status: 404, headers });
    const [activities, followups] = await Promise.all([
      supabase.from("real_estate_lead_activities").select("id,activity_type,details,created_at").eq("lead_id", leadId).eq("workspace_id", workspace.id).order("created_at", { ascending: false }).limit(100),
      supabase.from("real_estate_followups").select("id,sequence,channel,due_at,status,subject,sent_at,last_error_code").eq("lead_id", leadId).eq("workspace_id", workspace.id).order("sequence"),
    ]);
    if (activities.error || followups.error) throw activities.error ?? followups.error;
    return NextResponse.json({ lead, activities: activities.data ?? [], followups: followups.data ?? [] }, { headers });
  } catch (error) {
    console.error("Real-estate lead read failed", error);
    return NextResponse.json({ error: "Could not load this lead." }, { status: 500, headers });
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const { leadId } = await context.params;
    if (!uuid.test(leadId)) return NextResponse.json({ error: "Invalid lead ID." }, { status: 400, headers });
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers });
    const workspace = await getOrCreateDefaultWorkspace(supabase);
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > 12000) return NextResponse.json({ error: "Update exceeds 12 KiB." }, { status: 413, headers });
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400, headers }); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Update must be an object." }, { status: 400, headers });
    const input = body as Record<string, unknown>;
    const { data: current, error: currentError } = await supabase.from("real_estate_leads").select("*").eq("id", leadId).eq("workspace_id", workspace.id).maybeSingle();
    if (currentError) throw currentError;
    if (!current) return NextResponse.json({ error: "Lead not found." }, { status: 404, headers });

    const update: Record<string, unknown> = {};
    const map: Record<string, string> = {
      fullName: "full_name", email: "email", phone: "phone", transactionType: "transaction_type",
      propertyType: "property_type", preferredLocation: "preferred_location", budgetMin: "budget_min",
      budgetMax: "budget_max", currency: "currency", timeframe: "timeframe", readiness: "readiness",
      financingNotes: "financing_notes", mainConcern: "main_concern", contactPreference: "contact_preference",
    };
    for (const [key, column] of Object.entries(map)) if (key in input) update[column] = input[key];
    if ("status" in input) {
      if (!allowedStatuses.includes(String(input.status))) return NextResponse.json({ error: "Choose a valid lead status." }, { status: 400, headers });
      update.status = input.status;
      if (["won","lost"].includes(String(input.status))) update.closed_at = new Date().toISOString();
    }
    if ("assignedAgentId" in input) {
      const agentId = input.assignedAgentId;
      if (agentId !== null && (typeof agentId !== "string" || !uuid.test(agentId))) return NextResponse.json({ error: "Invalid agent ID." }, { status: 400, headers });
      if (agentId) {
        const { data: agent, error } = await supabase.from("agents").select("id").eq("id", agentId).eq("workspace_id", workspace.id).maybeSingle();
        if (error) throw error;
        if (!agent) return NextResponse.json({ error: "The selected agent does not belong to this workspace." }, { status: 403, headers });
      }
      update.assigned_agent_id = agentId;
    }
    if ("consentToContact" in input) {
      if (typeof input.consentToContact !== "boolean") return NextResponse.json({ error: "Consent must be true or false." }, { status: 400, headers });
      update.consent_to_contact = input.consentToContact;
      if (!input.consentToContact) { update.consent_at = null; update.consent_text = null; }
    }
    if (input.customerResponded === true) update.customer_responded_at = new Date().toISOString();
    const agentTookOver = input.agentTakesOver === true || (typeof input.status === "string" && ["contacted","viewing_scheduled","negotiation","won","lost"].includes(input.status));
    if (agentTookOver) {
      update.agent_takeover_at = new Date().toISOString();
      if (["contacted","viewing_scheduled","negotiation","won","lost"].includes(String(input.status))) update.first_contacted_at = current.first_contacted_at ?? new Date().toISOString();
      update.last_contacted_at = new Date().toISOString();
    }
    if ("full_name" in update && (typeof update.full_name !== "string" || !update.full_name.trim() || update.full_name.length > 160)) return NextResponse.json({ error: "Name must be 1–160 characters." }, { status: 400, headers });
    if ("email" in update && update.email !== null && (typeof update.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(update.email))) return NextResponse.json({ error: "Invalid email address." }, { status: 400, headers });
    if ("budget_min" in update && update.budget_min !== null) update.budget_min = Number(update.budget_min);
    if ("budget_max" in update && update.budget_max !== null) update.budget_max = Number(update.budget_max);
    const merged = { ...current, ...update };
    if (merged.budget_min !== null && merged.budget_max !== null && Number(merged.budget_max) < Number(merged.budget_min)) return NextResponse.json({ error: "Maximum budget cannot be below minimum budget." }, { status: 400, headers });
    const score = scoreRealEstateLead({
      transactionType: merged.transaction_type, propertyType: merged.property_type,
      preferredLocation: merged.preferred_location, budgetMin: merged.budget_min === null ? null : Number(merged.budget_min),
      budgetMax: merged.budget_max === null ? null : Number(merged.budget_max),
      timeframe: merged.timeframe, readiness: merged.readiness, email: merged.email, phone: merged.phone,
    });
    update.lead_score = score.score;
    update.lead_temperature = score.temperature;
    update.score_factors = score.factors;

    const { data: saved, error: saveError } = await supabase.from("real_estate_leads").update(update).eq("id", leadId).eq("workspace_id", workspace.id).select("*").single();
    if (saveError) throw saveError;
    const event = input.customerResponded === true ? "lead.customer_responded" : agentTookOver ? "lead.agent_took_over" : "lead.updated";
    const details = { updatedFields: Object.keys(update), status: saved.status, score: score.score };
    const { error: activityError } = await supabase.from("real_estate_lead_activities").insert({ workspace_id: workspace.id, lead_id: leadId, actor_user_id: user.id, activity_type: event, details });
    if (activityError) throw activityError;
    const stopReason = input.customerResponded === true ? "CUSTOMER_RESPONDED"
      : agentTookOver ? "AGENT_TAKEOVER"
      : input.consentToContact === false ? "CONSENT_WITHDRAWN"
      : ["won","lost"].includes(String(saved.status)) ? "LEAD_CLOSED" : null;
    if (stopReason) {
      const { error: stopError } = await supabase.rpc("stop_real_estate_followups", {
        p_workspace_id: workspace.id, p_lead_id: leadId, p_reason: stopReason,
      });
      if (stopError) throw stopError;
    }
    return NextResponse.json({ lead: saved, score }, { headers });
  } catch (error) {
    console.error("Real-estate lead update failed", error);
    return NextResponse.json({ error: "Could not update this lead." }, { status: 500, headers });
  }
}
