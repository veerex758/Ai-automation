import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
import { encryptWorkspaceCredentials, type WorkspaceCredentialProvider } from "@/lib/integrations/workspace-credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const providers = new Set<WorkspaceCredentialProvider>(["openai", "gemini", "resend", "slack", "http"]);
const labels: Record<WorkspaceCredentialProvider, string> = {
  openai: "OpenAI", gemini: "Gemini", resend: "Resend", slack: "Slack", http: "HTTP API",
};
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("INTEGRATION_DATABASE_NOT_CONFIGURED");
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json({ error: "Authentication required." }, 401);
    const workspace = await getOrCreateDefaultWorkspace(supabase);
    const { data, error } = await supabase.from("workspace_integrations")
      .select("id,provider,status,display_name,last_tested_at,last_test_status,updated_at")
      .eq("workspace_id", workspace.id).order("provider", { ascending: true });
    if (error) throw error;
    return json({ integrations: (data ?? []).map((item) => ({
      ...item,
      label: providers.has(item.provider as WorkspaceCredentialProvider)
        ? labels[item.provider as WorkspaceCredentialProvider] : "Integration",
    })) });
  } catch {
    return json({ error: "Could not load workspace integrations." }, 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (contentLength > 12 * 1024) return json({ error: "Credential request exceeds the 12 KB limit." }, 413);

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json({ error: "Authentication required." }, 401);

    let body: unknown;
    try { body = await request.json(); } catch { return json({ error: "Request body must be valid JSON." }, 400); }
    if (!isRecord(body) || typeof body.provider !== "string" || !providers.has(body.provider as WorkspaceCredentialProvider) ||
        !isRecord(body.credentials)) {
      return json({ error: "Provide a supported provider and its credential fields." }, 400);
    }

    const provider = body.provider as WorkspaceCredentialProvider;
    const displayName = typeof body.displayName === "string" && body.displayName.trim()
      ? body.displayName.trim().slice(0, 120) : labels[provider];
    const workspace = await getOrCreateDefaultWorkspace(supabase);
    const { data: membership, error: membershipError } = await supabase.from("workspace_members")
      .select("role").eq("workspace_id", workspace.id).eq("user_id", user.id).maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership || !["owner", "admin"].includes(membership.role)) {
      return json({ error: "Only workspace owners and admins can manage integrations." }, 403);
    }

    let encrypted: string;
    try {
      encrypted = encryptWorkspaceCredentials({ [provider]: body.credentials as Record<string, string> });
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      const status = code === "WORKSPACE_CREDENTIAL_ENCRYPTION_NOT_CONFIGURED" ||
        code === "WORKSPACE_CREDENTIAL_ENCRYPTION_KEY_INVALID" ? 503 : 400;
      return json({ error: status === 503
        ? "Workspace credential encryption is not configured on this server."
        : "Credential fields are invalid for this provider." }, status);
    }

    const db = serviceClient();
    const { data, error } = await db.rpc("save_workspace_integration_credentials", {
      p_workspace_id: workspace.id,
      p_provider: provider,
      p_display_name: displayName,
      p_encrypted_credentials: encrypted,
      p_created_by: user.id,
    });
    if (error || !data) throw error ?? new Error("INTEGRATION_SAVE_FAILED");
    return json({ integration: data }, 201);
  } catch {
    return json({ error: "Could not securely save this workspace integration." }, 500);
  }
}
