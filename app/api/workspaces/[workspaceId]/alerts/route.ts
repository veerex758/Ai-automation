import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptWorkspaceCredentials } from "@/lib/integrations/workspace-credentials";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
type Context = { params: Promise<{ workspaceId: string }> };
async function authorize(workspaceId: string) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { response: NextResponse.json({ error: "Authentication required." }, { status: 401, headers }) };
  const [{ data: workspace, error: we }, { data: member, error: me }] = await Promise.all([
    supabase.from("workspaces").select("owner_id").eq("id", workspaceId).maybeSingle(),
    supabase.from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle(),
  ]);
  if (we || me) return { response: NextResponse.json({ error: "Could not verify workspace access." }, { status: 503, headers }) };
  const role = workspace?.owner_id === user.id ? "owner" : member?.role;
  if (!workspace || !role || !["owner", "admin"].includes(role)) return { response: NextResponse.json({ error: "Workspace owner/admin access required." }, { status: 403, headers }) };
  return { user };
}
export async function GET(_request: Request, context: Context) {
  const { workspaceId } = await context.params;
  const access = await authorize(workspaceId);
  if ("response" in access) return access.response;
  const admin = createAdminClient();
  const [{ data: preferences, error: prefError }, { data: destinations, error: destError }, { data: deliveries, error: deliveryError }] = await Promise.all([
    admin.from("workspace_alert_preferences").select("enabled,events,minimum_severity,updated_at").eq("workspace_id", workspaceId).maybeSingle(),
    admin.from("workspace_alert_destinations").select("id,channel,destination,enabled,created_at,updated_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    admin.from("workspace_alert_deliveries").select("id,event_key,channel,status,error_code,created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(30),
  ]);
  const problem = prefError || destError || deliveryError;
  if (problem) return NextResponse.json({ error: "Could not load alert settings." }, { status: 503, headers });
  return NextResponse.json({ preferences: preferences ?? { enabled: true, events: ["queue_backlog", "dead_letter", "worker_offline", "workflow_failures", "provider_failure"], minimum_severity: "warning" }, destinations: destinations ?? [], recent_deliveries: deliveries ?? [] }, { headers });
}
export async function PATCH(request: Request, context: Context) {
  const { workspaceId } = await context.params;
  const access = await authorize(workspaceId);
  if ("response" in access) return access.response;
  try {
    const body = await request.json() as { enabled?: unknown; events?: unknown; minimum_severity?: unknown };
    const allowed = ["queue_backlog", "dead_letter", "worker_offline", "workflow_failures", "provider_failure"];
    if (typeof body.enabled !== "boolean" || !Array.isArray(body.events) || body.events.some((event) => typeof event !== "string" || !allowed.includes(event)) || !["warning", "critical"].includes(String(body.minimum_severity))) {
      return NextResponse.json({ error: "Invalid alert preferences." }, { status: 400, headers });
    }
    const admin = createAdminClient();
    const { data, error } = await admin.from("workspace_alert_preferences").upsert({ workspace_id: workspaceId, enabled: body.enabled, events: body.events, minimum_severity: body.minimum_severity, updated_by: access.user.id, updated_at: new Date().toISOString() }, { onConflict: "workspace_id" }).select("enabled,events,minimum_severity,updated_at").single();
    if (error) throw error;
    return NextResponse.json({ preferences: data }, { headers });
  } catch (error) {
    console.error("Operational alert preferences update failed:", error);
    return NextResponse.json({ error: "Could not update alert preferences." }, { status: 503, headers });
  }
}
export async function POST(request: Request, context: Context) {
  const { workspaceId } = await context.params;
  const access = await authorize(workspaceId);
  if ("response" in access) return access.response;
  try {
    const body = await request.json() as { channel?: unknown; destination?: unknown; webhook_url?: unknown };
    const channel = body.channel;
    if (channel !== "email" && channel !== "slack") return NextResponse.json({ error: "Channel must be email or slack." }, { status: 400, headers });
    const admin = createAdminClient();
    let destination = "", encrypted_secret: string | null = null;
    if (channel === "email") {
      destination = typeof body.destination === "string" ? body.destination.trim().toLowerCase() : "";
      if (destination.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destination)) return NextResponse.json({ error: "Enter a valid alert email address." }, { status: 400, headers });
    } else {
      const webhook = typeof body.webhook_url === "string" ? body.webhook_url.trim() : "";
      if (webhook.length > 500 || !/^https:\/\/hooks\.slack\.com\/services\/[A-Z0-9]+\/[A-Z0-9]+\/[A-Za-z0-9]+$/.test(webhook)) return NextResponse.json({ error: "Use a valid Slack incoming webhook URL." }, { status: 400, headers });
      destination = "Slack incoming webhook";
      const { data: inserted, error: insertError } = await admin.from("workspace_alert_destinations").insert({ workspace_id: workspaceId, channel, destination, encrypted_secret: "pending", created_by: access.user.id }).select("id").single();
      if (insertError) throw insertError;
      encrypted_secret = encryptWorkspaceCredentials({ slack: { webhookUrl: webhook } }, undefined, workspaceId + ":alert-slack:" + inserted.id);
      const { data, error } = await admin.from("workspace_alert_destinations").update({ encrypted_secret }).eq("id", inserted.id).select("id,channel,destination,enabled,created_at").single();
      if (error) throw error;
      return NextResponse.json({ destination: data }, { status: 201, headers });
    }
    const { data, error } = await admin.from("workspace_alert_destinations").insert({ workspace_id: workspaceId, channel, destination, encrypted_secret, created_by: access.user.id }).select("id,channel,destination,enabled,created_at").single();
    if (error) throw error;
    return NextResponse.json({ destination: data }, { status: 201, headers });
  } catch (error) {
    console.error("Operational alert destination create failed:", error);
    return NextResponse.json({ error: "Could not add alert destination. Check that it is unique and that credential encryption is configured." }, { status: 409, headers });
  }
}
export async function DELETE(request: Request, context: Context) {
  const { workspaceId } = await context.params;
  const access = await authorize(workspaceId);
  if ("response" in access) return access.response;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Destination id is required." }, { status: 400, headers });
  const admin = createAdminClient();
  const { error } = await admin.from("workspace_alert_destinations").delete().eq("id", id).eq("workspace_id", workspaceId);
  if (error) return NextResponse.json({ error: "Could not remove alert destination." }, { status: 503, headers });
  return NextResponse.json({ deleted: true }, { headers });
}
