import "server-only";

export type WorkspaceCredentialProvider = "notion" | "discord" | "telegram" | "airtable" | "trello" | "hubspot";
export type WorkspaceProviderCredentials = Record<string, string>;
type FetchLike = typeof fetch;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/** Non-destructive GET-only credential verification. Never returns or logs token material. */
export async function verifyWorkspaceProviderCredentials(
  provider: WorkspaceCredentialProvider,
  credentials: WorkspaceProviderCredentials,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
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
    response = await fetchImpl(url, {
      method: "GET", headers, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000),
    });
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
