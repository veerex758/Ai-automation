import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";
import { encryptWorkspaceCredentials } from "@/lib/integrations/workspace-credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Provider = "notion" | "discord" | "telegram" | "airtable" | "trello" | "hubspot";
type Credentials = Record<string, string>;

const noStore = { "Cache-Control": "private, no-store" };
const providers: Record<Provider, { required: string[]; optional?: string[] }> = {
  notion: { required: ["apiKey"] },
  discord: { required: ["botToken"] },
  telegram: { required: ["botToken"] },
  airtable: { required: ["accessToken"] },
  trello: { required: ["apiKey", "token"] },
  hubspot: { required: ["accessToken"] },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseCredentials(provider: Provider, value: unknown): Credentials | null {
  if (!isRecord(value)) return null;
  const schema = providers[provider];
  const keys = Object.keys(value);
  if (keys.some((key) => ![...schema.required, ...(schema.optional ?? [])].includes(key))) return null;
  const credentials: Credentials = {};
  for (const key of schema.required) {
    const secret = value[key];
    if (typeof secret !== "string" || !secret.trim() || secret.length > 4096) return null;
    credentials[key] = secret.trim();
  }
  for (const key of schema.optional ?? []) {
    const secret = value[key];
    if (secret !== undefined) {
      if (typeof secret !== "string" || secret.length > 4096) return null;
      credentials[key] = secret;
    }
  }
  return credentials;
}

async function verifyProvider(provider: Provider, credentials: Credentials): Promise<string> {
  let url = "";
  const headers: Record<string, string> = {};
  if (provider === "notion") {
    url = "https://api.notion.com/v1/users/me";
    headers.Authorization = "Bearer " + credentials.apiKey;
    headers["Notion-Version"] = "2022-06-28";
  } else if (provider === "discord") {
    url = "https://discord.com/api/v10/users/@me";
    headers.Authorization = "Bot " + credentials.botToken;
  } else if (provider === "telegram") {
    url = "https://api.telegram.org/bot" + credentials.botToken + "/getMe";
  } else if (provider === "airtable") {
    url = "https://api.airtable.com/v0/meta/whoami";
    headers.Authorization = "Bearer " + credentials.accessToken;
  } else if (provider === "hubspot") {
    url = "https://api.hubapi.com/oauth/v1/access-tokens/" + encodeURIComponent(credentials.accessToken);
  } else {
    const target = new URL("https://api.trello.com/1/members/me");
    target.searchParams.set("key", credentials.apiKey);
    target.searchParams.set("token", credentials.token);
    url = target.toString();
  }

  let response: Response;
  try {
    response = await fetch(url, { method: "GET", headers, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000) });
  } catch {
    throw new Error("PROVIDER_UNREACHABLE");
  }
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "PROVIDER_AUTH_REJECTED" : "PROVIDER_CONNECTION_FAILED");
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new Error("PROVIDER_INVALID_RESPONSE"); }
  if (!isRecord(payload)) throw new Error("PROVIDER_INVALID_RESPONSE");
  if (provider === "telegram") {
    if (payload.ok !== true || !isRecord(payload.result)) throw new Error("PROVIDER_AUTH_REJECTED");
    return typeof payload.result.username === "string" ? "@" + payload.result.username : "Telegram bot";
  }
  if (provider === "discord") return typeof payload.username === "string" ? payload.username : "Discord bot";
  if (provider === "notion") return typeof payload.name === "string" ? payload.name : "Notion integration";
  if (provider === "hubspot") {
    const scopes = Array.isArray(payload.scopes) ? payload.scopes : [];
    if (!scopes.includes("crm.objects.contacts.write")) throw new Error("PROVIDER_AUTH_REJECTED");
    return typeof payload.hub_id === "number" ? "HubSpot portal " + payload.hub_id : "HubSpot portal";
  }
  if (provider === "airtable") return typeof payload.id === "string" ? "Airtable account" : "Airtable";
  return typeof payload.username === "string" ? payload.username : "Trello account";
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("WORKSPACE_CREDENTIAL_STORAGE_NOT_CONFIGURED");
  return createSupabaseClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers: noStore });
    const workspace = await getOrCreateDefaultWorkspace(supabase);
    const { data, error: listError } = await supabase.from("workspace_integrations")
      .select("id,provider,status,display_name,metadata,last_tested_at,last_test_status,updated_at")
      .eq("workspace_id", workspace.id).order("provider");
    if (listError) throw listError;
    return NextResponse.json({ integrations: data ?? [] }, { headers: noStore });
  } catch {
    return NextResponse.json({ error: "Could not load workspace integrations." }, { status: 500, headers: noStore });
  }
}

export async function POST(request: NextRequest) {
  try {
    const length = Number(request.headers.get("content-length") || 0);
    if (length > 12000) return NextResponse.json({ error: "Credential request is too large." }, { status: 413, headers: noStore });
    const body: unknown = await request.json().catch(() => null);
    if (!isRecord(body) || typeof body.provider !== "string" || !Object.hasOwn(providers, body.provider)) {
      return NextResponse.json({ error: "Choose a supported API-key integration." }, { status: 400, headers: noStore });
    }
    const provider = body.provider as Provider;
    const credentials = parseCredentials(provider, body.credentials);
    if (!credentials) return NextResponse.json({ error: "Credential fields are missing or invalid." }, { status: 400, headers: noStore });

    // Validate encryption configuration before making any provider request.
    const encryptedCredentials = encryptWorkspaceCredentials(credentials);
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers: noStore });
    const workspace = await getOrCreateDefaultWorkspace(supabase);

    let accountLabel: string;
    try {
      accountLabel = await verifyProvider(provider, credentials);
    } catch (error) {
      const code = error instanceof Error ? error.message : "PROVIDER_CONNECTION_FAILED";
      const messages: Record<string, string> = {
        PROVIDER_UNREACHABLE: "The provider could not be reached. Check your network and try again.",
        PROVIDER_AUTH_REJECTED: "The provider rejected these credentials. Check the token and required permissions.",
        PROVIDER_CONNECTION_FAILED: "The provider connection test failed. No credentials were saved.",
        PROVIDER_INVALID_RESPONSE: "The provider returned an unexpected response. No credentials were saved.",
      };
      return NextResponse.json({ error: messages[code] ?? "The provider connection test failed." }, { status: 422, headers: noStore });
    }

    // RLS on metadata enforces workspace owner/admin write access. The service-role
    // client is used only for the encrypted secret row and is never returned to clients.
    const { data: integration, error: saveMetadataError } = await supabase.from("workspace_integrations")
      .upsert({
        workspace_id: workspace.id,
        provider,
        status: "connected",
        display_name: accountLabel.slice(0, 120),
        metadata: { accountLabel: accountLabel.slice(0, 120) },
        last_tested_at: new Date().toISOString(),
        last_test_status: "passed",
        created_by: user.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: "workspace_id,provider" })
      .select("id,provider,status,display_name,metadata,last_tested_at,last_test_status,updated_at")
      .single();
    if (saveMetadataError || !integration) {
      return NextResponse.json({ error: "You need workspace owner or admin access to save this integration." }, { status: 403, headers: noStore });
    }

    const { error: saveSecretError } = await adminClient().from("workspace_integration_secrets").upsert({
      integration_id: integration.id,
      encrypted_credentials: encryptedCredentials,
      encryption_version: "v1",
      updated_at: new Date().toISOString(),
    }, { onConflict: "integration_id" });
    if (saveSecretError) {
      await supabase.from("workspace_integrations").update({ status: "needs_attention", last_test_status: "failed" })
        .eq("id", integration.id).eq("workspace_id", workspace.id);
      return NextResponse.json({ error: "The connection passed its test but secure storage failed. No live actions are enabled." }, { status: 503, headers: noStore });
    }

    return NextResponse.json({ integration, connected: true, tested: true }, { status: 201, headers: noStore });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const status = code === "WORKSPACE_CREDENTIAL_STORAGE_NOT_CONFIGURED" ? 503 : 500;
    return NextResponse.json({ error: status === 503 ? "Secure credential storage is not configured." : "Could not save the integration securely." }, { status, headers: noStore });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const provider = request.nextUrl.searchParams.get("provider") ?? "";
    if (!Object.hasOwn(providers, provider)) return NextResponse.json({ error: "Choose a supported API-key integration." }, { status: 400, headers: noStore });
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers: noStore });
    const workspace = await getOrCreateDefaultWorkspace(supabase);
    const { error: deleteError } = await supabase.from("workspace_integrations").delete()
      .eq("workspace_id", workspace.id).eq("provider", provider);
    if (deleteError) return NextResponse.json({ error: "Only workspace owners or admins can disconnect this integration." }, { status: 403, headers: noStore });
    return NextResponse.json({ disconnected: true }, { headers: noStore });
  } catch {
    return NextResponse.json({ error: "Could not disconnect the integration." }, { status: 500, headers: noStore });
  }
}
