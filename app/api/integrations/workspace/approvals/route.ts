import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
import { getWorkerOperationMapping } from "@/lib/workflows/worker-operation-map";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("APPROVAL_STORAGE_NOT_CONFIGURED");
  return createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

async function authenticatedWorkspace() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { response: json({ error: "Authentication required." }, 401) } as const;
  const workspace = await getOrCreateDefaultWorkspace(supabase);
  return { user, workspace, supabase } as const;
}

export async function GET() {
  try {
    const auth = await authenticatedWorkspace();
    if ("response" in auth) return auth.response;
    const { data, error } = await adminClient().from("workspace_provider_operation_approvals")
      .select("id,provider,node_id,operation_id,decision,decided_by,decided_at,reason")
      .eq("workspace_id", auth.workspace.id)
      .order("decided_at", { ascending: false })
      .limit(500);
    if (error) return json({ error: "Unable to load workspace approvals." }, 503);
    return json({ approvals: data ?? [] });
  } catch {
    return json({ error: "Approval storage is not configured." }, 503);
  }
}

export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).origin !== new URL(request.url).origin) return json({ error: "Cross-origin request rejected." }, 403);
    const auth = await authenticatedWorkspace();
    if ("response" in auth) return auth.response;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body.nodeId !== "string" || typeof body.operationId !== "string" ||
        typeof body.kind !== "string" || !["trigger", "action"].includes(body.kind) ||
        typeof body.decision !== "string" || !["approved", "revoked"].includes(body.decision) ||
        (body.reason !== undefined && (typeof body.reason !== "string" || body.reason.length > 500))) {
      return json({ error: "Invalid approval request." }, 400);
    }
    const { data: membership, error: membershipError } = await auth.supabase.from("workspace_members")
      .select("role").eq("workspace_id", auth.workspace.id).eq("user_id", auth.user.id).maybeSingle();
    if (membershipError) return json({ error: "Unable to verify workspace permissions." }, 503);
    if (!membership || !["owner", "admin"].includes(membership.role)) {
      return json({ error: "Only workspace owners and admins can change provider approvals." }, 403);
    }
    const mapping = getWorkerOperationMapping({
      nodeId: body.nodeId,
      operationId: body.operationId,
      kind: body.kind as "trigger" | "action",
    });
    if (!mapping || !mapping.provider || (body.provider !== undefined && body.provider !== mapping.provider)) {
      return json({ error: "The requested operation is not registered for this provider." }, 400);
    }
    const { data, error } = await adminClient().from("workspace_provider_operation_approvals")
      .insert({
        workspace_id: auth.workspace.id,
        provider: mapping.provider,
        node_id: mapping.nodeId,
        operation_id: mapping.operationId,
        decision: body.decision,
        decided_by: auth.user.id,
        reason: typeof body.reason === "string" ? body.reason.trim() || null : null,
      })
      .select("id,provider,node_id,operation_id,decision,decided_by,decided_at,reason")
      .single();
    if (error || !data) return json({ error: "Unable to save workspace approval." }, 503);
    return json({ approval: data }, 201);
  } catch {
    return json({ error: "Unable to save workspace approval." }, 503);
  }
}
