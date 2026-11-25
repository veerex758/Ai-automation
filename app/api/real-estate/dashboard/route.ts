import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers });

    const workspace = await getOrCreateDefaultWorkspace(supabase);
    const workspaceId = workspace.id;
    const [
      totalResult, newLeadsResult, qualifiedResult, highScoringResult, hotResult, warmResult, coldResult,
      viewingsResult, wonResult, lostResult, propertiesResult, activePropertiesResult,
      followupsDueResult, agentsResult,
    ] = await Promise.all([
      supabase.from("real_estate_leads").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
      supabase.from("real_estate_leads").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("status", "new"),
      supabase.from("real_estate_leads").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("qualification_status", "succeeded"),
      supabase.from("real_estate_leads").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).gte("lead_score", 50),
      supabase.from("real_estate_leads").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("lead_temperature", "hot"),
      supabase.from("real_estate_leads").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("lead_temperature", "warm"),
      supabase.from("real_estate_leads").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("lead_temperature", "cold"),
      supabase.from("real_estate_leads").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("status", "viewing_scheduled"),
      supabase.from("real_estate_leads").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("status", "won"),
      supabase.from("real_estate_leads").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("status", "lost"),
      supabase.from("real_estate_properties").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
      supabase.from("real_estate_properties").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("available", true),
      supabase.from("real_estate_followups").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("status", "pending").lte("due_at", new Date().toISOString()),
      supabase.from("agents").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    ]);
    const countError = [
      totalResult, newLeadsResult, qualifiedResult, highScoringResult, hotResult, warmResult, coldResult,
      viewingsResult, wonResult, lostResult, propertiesResult, activePropertiesResult,
      followupsDueResult, agentsResult,
    ].find((result) => result.error)?.error;
    if (countError) throw countError;

    const [
      { data: recentLeads, error: recentError },
      { data: recentActivities, error: activityError },
      { data: sourceRows, error: sourceError },
    ] = await Promise.all([
      supabase.from("real_estate_leads")
        .select("id,full_name,email,phone,lead_score,lead_temperature,status,source,preferred_location,created_at")
        .eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(8),
      supabase.from("real_estate_lead_activities")
        .select("id,lead_id,activity_type,details,created_at")
        .eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(12),
      supabase.from("real_estate_leads").select("source").eq("workspace_id", workspaceId).limit(1000),
    ]);
    if (recentError || activityError || sourceError) throw recentError ?? activityError ?? sourceError;

    const bySource = new Map<string, number>();
    for (const row of sourceRows ?? []) {
      const source = row.source ?? "unknown";
      bySource.set(source, (bySource.get(source) ?? 0) + 1);
    }

    return NextResponse.json({
      stats: {
        total: totalResult.count ?? 0,
        newLeads: newLeadsResult.count ?? 0,
        qualified: qualifiedResult.count ?? 0,
        highScoring: highScoringResult.count ?? 0,
        hot: hotResult.count ?? 0,
        warm: warmResult.count ?? 0,
        cold: coldResult.count ?? 0,
        viewings: viewingsResult.count ?? 0,
        won: wonResult.count ?? 0,
        lost: lostResult.count ?? 0,
        properties: propertiesResult.count ?? 0,
        activeProperties: activePropertiesResult.count ?? 0,
        followupsDue: followupsDueResult.count ?? 0,
        agents: agentsResult.count ?? 0,
      },
      sources: [...bySource].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count),
      recentLeads: recentLeads ?? [],
      recentActivities: recentActivities ?? [],
    }, { headers });
  } catch (error) {
    console.error("Real-estate dashboard data failed", error);
    return NextResponse.json({ error: "Could not load real-estate dashboard data." }, { status: 500, headers });
  }
}
