import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Context = { params: Promise<{ recipientId: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const { recipientId } = await context.params;
    if (!uuid.test(recipientId)) return NextResponse.json({ error: "Invalid recipient ID." }, { status: 400, headers });
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers });
    const workspace = await getOrCreateDefaultWorkspace(supabase);
    const { data: membership, error: membershipError } = await supabase.from("workspace_members")
      .select("role").eq("workspace_id", workspace.id).eq("user_id", user.id).maybeSingle();
    if (membershipError || !membership || !["owner", "admin"].includes(membership.role)) {
      return NextResponse.json({ error: "Only a workspace owner or admin can change agency alert approvals." }, { status: 403, headers });
    }

    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > 2048) return NextResponse.json({ error: "Recipient update exceeds 2 KiB." }, { status: 413, headers });
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400, headers }); }
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof (body as Record<string, unknown>).active !== "boolean") {
      return NextResponse.json({ error: "An active true/false value is required." }, { status: 400, headers });
    }
    const active = (body as Record<string, unknown>).active as boolean;
    const update = { active };
    const { data, error } = await supabase.from("real_estate_notification_recipients")
      .update(update).eq("id", recipientId).eq("workspace_id", workspace.id)
      .select("id,email,active,approved_at,created_at,revoked_at").maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Recipient not found in this workspace." }, { status: 404, headers });
    return NextResponse.json({ recipient: data }, { headers });
  } catch (error) {
    console.error("Agency notification recipient update failed", error);
    return NextResponse.json({ error: "Could not update agency alert approval." }, { status: 500, headers });
  }
}
