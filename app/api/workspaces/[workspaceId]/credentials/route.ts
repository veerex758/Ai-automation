import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encryptCredentialSecret } from "@/lib/credentials/secret-crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROVIDERS = new Set(["openai", "slack", "resend", "http"]);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("CREDENTIAL_VAULT_DATABASE_NOT_CONFIGURED");
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function authorizeWorkspace(workspaceId: string) {
  if (!UUID.test(workspaceId)) return { response: json({ error: "Invalid workspace ID." }, 400) } as const;
  const userClient = await createClient();
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return { response: json({ error: "Authentication required." }, 401) } as const;

  const { data: workspace, error: workspaceError } = await userClient.from("workspaces")
    .select("owner_id").eq("id", workspaceId).maybeSingle();
  if (workspaceError) throw workspaceError;
  if (!workspace) return { response: json({ error: "Workspace not found or access denied." }, 404) } as const;
  const isOwner = workspace.owner_id === user.id;
  if (!isOwner) {
    const { data: membership, error } = await userClient.from("workspace_members")
      .select("role").eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle();
    if (error) throw error;
    if (!membership || !["owner", "admin"].includes(membership.role)) {
      return { response: json({ error: "Workspace owner or admin access is required." }, 403) } as const;
    }
  }
  return { user, admin: adminClient() } as const;
}

/** Lists credential metadata only; plaintext is never returned by this API. */
export async function GET(_request: NextRequest, context: { params: Promise<{ workspaceId: string }> }) {
  try {
    const { workspaceId } = await context.params;
    const access = await authorizeWorkspace(workspaceId);
    if ("response" in access) return access.response;
    const { data, error } = await access.admin.from("workspace_credentials")
      .select("id,provider,display_name,secret_key_version,status,created_at,updated_at")
      .eq("workspace_id", workspaceId).order("created_at", { ascending: false });
    if (error) throw error;
    return json({ credentials: data ?? [] });
  } catch {
    return json({ error: "Could not load workspace credentials." }, 500);
  }
}

/** Stores an encrypted credential. The submitted secret is never echoed or logged. */
export async function POST(request: NextRequest, context: { params: Promise<{ workspaceId: string }> }) {
  try {
    const { workspaceId } = await context.params;
    const access = await authorizeWorkspace(workspaceId);
    if ("response" in access) return access.response;

    let body: unknown;
    try { body = await request.json(); } catch { return json({ error: "Request body must be valid JSON." }, 400); }
    if (!isRecord(body) || typeof body.provider !== "string" || !PROVIDERS.has(body.provider) ||
        typeof body.displayName !== "string" || body.displayName.trim().length < 1 ||
        body.displayName.trim().length > 120 || !isRecord(body.secret)) {
      return json({ error: "Provide a supported provider, displayName, and secret object." }, 400);
    }
    const secretEntries = Object.entries(body.secret);
    if (!secretEntries.length || secretEntries.length > 20 ||
        secretEntries.some(([key, value]) => !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key) ||
          typeof value !== "string" || !value.trim() || Buffer.byteLength(value, "utf8") > 8192)) {
      return json({ error: "Secret must contain 1–20 named, non-empty string values (each at most 8 KB)." }, 400);
    }
    const encodedKey = process.env.AIVANTA_CREDENTIALS_ENCRYPTION_KEY;
    const keyVersion = process.env.AIVANTA_CREDENTIALS_KEY_VERSION ?? "v1";
    if (!encodedKey) return json({ error: "Credential vault encryption is not configured on this server." }, 503);

    const ciphertext = encryptCredentialSecret(JSON.stringify(body.secret), encodedKey, `${workspaceId}:${body.provider}`);
    const { data, error } = await access.admin.from("workspace_credentials").insert({
      workspace_id: workspaceId,
      provider: body.provider,
      display_name: body.displayName.trim(),
      secret_ciphertext: `\\x${ciphertext.toString("hex")}`,
      secret_key_version: keyVersion,
      status: "active",
      created_by: access.user.id,
    }).select("id,provider,display_name,secret_key_version,status,created_at").single();
    if (error) {
      if (error.code === "23505") return json({ error: "A credential with this provider and display name already exists." }, 409);
      throw error;
    }
    return json({ credential: data }, 201);
  } catch (error) {
    if (error instanceof Error && /AIVANTA_CREDENTIALS_ENCRYPTION_KEY/.test(error.message)) {
      return json({ error: "Credential vault encryption key is invalid or not configured." }, 503);
    }
    return json({ error: "Could not save workspace credential." }, 500);
  }
}

/** Revocation is soft-delete: history is retained and the secret cannot be selected for new runs. */
export async function DELETE(request: NextRequest, context: { params: Promise<{ workspaceId: string }> }) {
  try {
    const { workspaceId } = await context.params;
    const access = await authorizeWorkspace(workspaceId);
    if ("response" in access) return access.response;
    let body: unknown;
    try { body = await request.json(); } catch { return json({ error: "Request body must be valid JSON." }, 400); }
    if (!isRecord(body) || typeof body.credentialId !== "string" || !UUID.test(body.credentialId)) {
      return json({ error: "Provide a valid credentialId." }, 400);
    }
    const { data, error } = await access.admin.from("workspace_credentials")
      .update({ status: "revoked" }).eq("id", body.credentialId).eq("workspace_id", workspaceId)
      .eq("status", "active").select("id,status").maybeSingle();
    if (error) throw error;
    if (!data) return json({ error: "Active credential not found in this workspace." }, 404);
    return json({ credential: data });
  } catch {
    return json({ error: "Could not revoke workspace credential." }, 500);
  }
}
