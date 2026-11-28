import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
import { hasWorkspacePermission } from "@/lib/supabase/permissions";
import { validateDefinition } from "@/lib/workflows/validate-definition.cjs";
import { validateRegisteredSteps } from "@/nodes/validate-steps";
import playbookDefinition from "@/lib/playbooks/definition.cjs";
import { replayPlaybookAgainstLead } from "@/lib/playbooks/replay";

export const dynamic = "force-dynamic";
const { validatePlaybookDefinition } = playbookDefinition;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const headers = { "Cache-Control": "private, no-store" };

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers });

    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > 12000) return NextResponse.json({ error: "Replay request exceeds 12 KiB." }, { status: 413, headers });
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400, headers }); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Replay request must be an object." }, { status: 400, headers });
    const input = body as Record<string, unknown>;
    if (typeof input.workflowId !== "string" || !uuid.test(input.workflowId) ||
        !Number.isInteger(input.version) || Number(input.version) < 1 ||
        !Array.isArray(input.leadIds) || input.leadIds.length < 1 || input.leadIds.length > 50 ||
        input.leadIds.some((id) => typeof id !== "string" || !uuid.test(id)) ||
        new Set(input.leadIds).size !== input.leadIds.length) {
      return NextResponse.json({ error: "Choose one Playbook version and between 1 and 50 unique historical enquiries." }, { status: 400, headers });
    }

    const workspace = await getOrCreateDefaultWorkspace(supabase);
    if (!(await hasWorkspacePermission(supabase, workspace.id, user.id, "workflows.view"))) {
      return NextResponse.json({ error: "Workspace workflows.view permission required." }, { status: 403, headers });
    }
    const { data: workflow, error: workflowError } = await supabase.from("workflows")
      .select("id,workspace_id").eq("id", input.workflowId).eq("workspace_id", workspace.id).maybeSingle();
    if (workflowError) throw workflowError;
    if (!workflow) return NextResponse.json({ error: "Playbook not found in this workspace." }, { status: 404, headers });

    const { data: versionRow, error: versionError } = await supabase.from("workflow_versions")
      .select("workflow_id,version,definition").eq("workflow_id", workflow.id).eq("version", input.version).maybeSingle();
    if (versionError) throw versionError;
    if (!versionRow || !versionRow.definition || typeof versionRow.definition !== "object" || Array.isArray(versionRow.definition)) {
      return NextResponse.json({ error: "The requested immutable Playbook version was not found." }, { status: 404, headers });
    }
    const stored = versionRow.definition as Record<string, unknown>;
    if (!stored.playbook || stored.format !== "aivanta-registry-v1") {
      return NextResponse.json({ error: "The selected version is not a registered Rexnora Playbook." }, { status: 422, headers });
    }
    const graph = validateDefinition(stored);
    if (!graph.definition) return NextResponse.json({ error: "The saved Playbook graph needs repair before replay.", detail: graph.error }, { status: 422, headers });
    const plan = validateRegisteredSteps(stored.steps);
    const registeredSteps = plan.steps;
    if (!registeredSteps) return NextResponse.json({ error: "The saved registered operations need repair before replay.", detail: plan.error }, { status: 422, headers });
    const checkedPlaybook = validatePlaybookDefinition(stored.playbook, graph.definition, registeredSteps);
    const playbook = checkedPlaybook.playbook;
    if (!playbook) return NextResponse.json({ error: "The saved Playbook policy needs repair before replay.", detail: checkedPlaybook.error }, { status: 422, headers });

    const { data: leads, error: leadsError } = await supabase.from("real_estate_leads")
      .select("id,full_name,source,transaction_type,property_type,preferred_location,budget_min,budget_max,currency,timeframe,readiness,main_concern,lead_score,qualification,raw_enquiry,created_at")
      .eq("workspace_id", workspace.id).in("id", input.leadIds as string[]);
    if (leadsError) throw leadsError;
    if (!leads || leads.length !== input.leadIds.length) return NextResponse.json({ error: "One or more selected enquiries are unavailable in this workspace." }, { status: 404, headers });

    const results = leads.map((lead) => replayPlaybookAgainstLead(playbook, registeredSteps, lead));
    return NextResponse.json({
      safePreview: true,
      sideEffects: false,
      providerCalls: 0,
      writes: 0,
      workflowId: workflow.id,
      version: versionRow.version,
      sampleCount: results.length,
      results,
    }, { headers });
  } catch (error) {
    console.error("Playbook historical replay failed", error);
    return NextResponse.json({ error: "Could not replay this Playbook version." }, { status: 500, headers });
  }
}
