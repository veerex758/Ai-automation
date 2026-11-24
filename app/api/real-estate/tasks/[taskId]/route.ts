import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
import { hasWorkspacePermission } from "@/lib/supabase/permissions";
import { createRealEstateServiceClient } from "@/lib/real-estate/server";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
type Context = { params: Promise<{ taskId: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const { taskId } = await context.params;
    if (!uuid.test(taskId)) return NextResponse.json({ error: "Invalid task ID." }, { status: 400, headers });
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers });
    const workspace = await getOrCreateDefaultWorkspace(supabase);
    if (!(await hasWorkspacePermission(supabase, workspace.id, user.id, "operations.manage"))) {
      return NextResponse.json({ error: "Workspace operations.manage permission required." }, { status: 403, headers });
    }
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > 2048) return NextResponse.json({ error: "Task update is too large." }, { status: 413, headers });
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400, headers }); }
    const status = body && typeof body === "object" ? (body as Record<string, unknown>).status : undefined;
    if (status !== "open" && status !== "in_progress" && status !== "completed" && status !== "cancelled") {
      return NextResponse.json({ error: "Choose a valid task status." }, { status: 400, headers });
    }
    const db = createRealEstateServiceClient();
    const now = new Date().toISOString();
    const { data, error } = await db.from("real_estate_tasks").update({
      status,
      completed_at: status === "completed" ? now : null,
      updated_at: now,
    }).eq("id", taskId).eq("workspace_id", workspace.id)
      .select("id,status,completed_at,updated_at").maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Task not found in this workspace." }, { status: 404, headers });
    return NextResponse.json({ task: data }, { headers });
  } catch (error) {
    console.error("Real-estate task update failed", error);
    return NextResponse.json({ error: "Could not update this back-office task." }, { status: 500, headers });
  }
}
