import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

async function authenticatedWorkspace() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { response: NextResponse.json({ error: "Authentication required." }, { status: 401, headers }) };
  const workspace = await getOrCreateDefaultWorkspace(supabase);
  return { supabase, user, workspace };
}

async function assertWorkspaceAdmin(supabase: Awaited<ReturnType<typeof createClient>>, workspaceId: string, userId: string) {
  const { data, error } = await supabase.from("workspace_members")
    .select("role").eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle();
  if (error || !data || !["owner", "admin"].includes(data.role)) {
    return NextResponse.json({ error: "Only a workspace owner or admin can approve agency alert recipients." }, { status: 403, headers });
  }
  return null;
}

export async function GET() {
  try {
    const auth = await authenticatedWorkspace();
    if ("response" in auth) return auth.response;
    const { data, error } = await auth.supabase.from("real_estate_notification_recipients")
      .select("id,email,active,approved_at,created_at,revoked_at")
      .eq("workspace_id", auth.workspace.id).order("created_at", { ascending: true }).limit(50);
    if (error) throw error;
    return NextResponse.json({ recipients: data ?? [] }, { headers });
  } catch (error) {
    console.error("Agency notification recipient list failed", error);
    return NextResponse.json({ error: "Could not load agency alert recipients. Apply the notification-recipient migration if this is a new deployment." }, { status: 503, headers });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticatedWorkspace();
    if ("response" in auth) return auth.response;
    const denied = await assertWorkspaceAdmin(auth.supabase, auth.workspace.id, auth.user.id);
    if (denied) return denied;

    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > 2048) return NextResponse.json({ error: "Recipient input exceeds 2 KiB." }, { status: 413, headers });
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400, headers }); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Recipient input must be an object." }, { status: 400, headers });
    const email = typeof (body as Record<string, unknown>).email === "string"
      ? String((body as Record<string, unknown>).email).trim().toLowerCase()
      : "";
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Enter a valid agency email address." }, { status: 400, headers });
    }

    const { count, error: countError } = await auth.supabase.from("real_estate_notification_recipients")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", auth.workspace.id).eq("active", true);
    if (countError) throw countError;
    if ((count ?? 0) >= 25) return NextResponse.json({ error: "A workspace can have at most 25 active agency alert recipients." }, { status: 409, headers });

    const { data, error } = await auth.supabase.from("real_estate_notification_recipients").insert({
      workspace_id: auth.workspace.id,
      email,
      active: true,
    }).select("id,email,active,approved_at,created_at,revoked_at").single();
    if (error?.code === "23505") return NextResponse.json({ error: "That email address is already on the workspace recipient list." }, { status: 409, headers });
    if (error) throw error;
    return NextResponse.json({ recipient: data }, { status: 201, headers });
  } catch (error) {
    console.error("Agency notification recipient approval failed", error);
    return NextResponse.json({ error: "Could not approve this agency alert recipient." }, { status: 500, headers });
  }
}
