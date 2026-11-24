import "server-only";
import { decryptGoogleCredentials, encryptGoogleCredentials } from "@/lib/integrations/google-credentials";
import { getGoogleOAuthConfig, GOOGLE_PRODUCTS, hasOnlyApprovedGoogleScopes } from "@/lib/integrations/google-oauth";
import { createRealEstateServiceClient } from "@/lib/real-estate/server";
import { findOperation } from "@/nodes/registry";
import type { NodeContext } from "@/nodes/types";

type ServiceClient = ReturnType<typeof createRealEstateServiceClient>;

export async function getRealEstateGoogleCalendarAccessToken(
  db: ServiceClient,
  workspaceId: string,
  connectionId: string,
): Promise<string> {
  const { data: connection, error } = await db.from("google_connections")
    .select("id,workspace_id,product,provider,scopes,status,last_test_status,expires_at,encrypted_credentials")
    .eq("id", connectionId)
    .eq("workspace_id", workspaceId)
    .eq("provider", "google")
    .eq("product", "calendar")
    .eq("status", "connected")
    .eq("last_test_status", "passed")
    .maybeSingle();
  if (error || !connection) throw new Error("GOOGLE_CALENDAR_CONNECTION_NOT_VERIFIED");

  const requiredScope = GOOGLE_PRODUCTS.calendar.scopes[0];
  if (!Array.isArray(connection.scopes) || !connection.scopes.includes(requiredScope) ||
      !hasOnlyApprovedGoogleScopes("calendar", connection.scopes.join(" "))) {
    throw new Error("GOOGLE_CALENDAR_SCOPE_MISMATCH");
  }
  let credentials;
  try { credentials = decryptGoogleCredentials(connection.encrypted_credentials); }
  catch { throw new Error("GOOGLE_CALENDAR_CREDENTIALS_DECRYPT_FAILED"); }

  const expiry = credentials.expiry_date ?? (connection.expires_at ? new Date(connection.expires_at).getTime() : 0);
  if (expiry > Date.now() + 60_000) return credentials.access_token;
  if (!credentials.refresh_token) throw new Error("GOOGLE_CALENDAR_REAUTH_REQUIRED");

  const config = getGoogleOAuthConfig();
  const refresh = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: credentials.refresh_token,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  const token = await refresh.json().catch(() => null) as {
    access_token?: unknown; expires_in?: unknown; scope?: unknown; token_type?: unknown;
  } | null;
  if (!refresh.ok || typeof token?.access_token !== "string" ||
      typeof token.expires_in !== "number" || !Number.isFinite(token.expires_in)) {
    await db.from("google_connections").update({
      status: "needs_reauth", last_test_status: "failed", updated_at: new Date().toISOString(),
    }).eq("id", connection.id).eq("workspace_id", workspaceId);
    throw new Error("GOOGLE_CALENDAR_REAUTH_REQUIRED");
  }
  if (typeof token.scope === "string" &&
      (!hasOnlyApprovedGoogleScopes("calendar", token.scope) || !token.scope.split(/\\s+/).includes(requiredScope))) {
    throw new Error("GOOGLE_CALENDAR_REFRESH_SCOPE_MISMATCH");
  }
  const expiryDate = Date.now() + token.expires_in * 1000;
  const updated = {
    ...credentials,
    access_token: token.access_token,
    expiry_date: expiryDate,
    ...(typeof token.scope === "string" ? { scope: token.scope } : {}),
    ...(typeof token.token_type === "string" ? { token_type: token.token_type } : {}),
  };
  const { error: saveError } = await db.from("google_connections").update({
    encrypted_credentials: encryptGoogleCredentials(updated),
    expires_at: new Date(expiryDate).toISOString(),
    status: "connected",
    last_test_status: "passed",
    updated_at: new Date().toISOString(),
  }).eq("id", connection.id).eq("workspace_id", workspaceId);
  if (saveError) throw new Error("GOOGLE_CALENDAR_TOKEN_REFRESH_SAVE_FAILED");
  return updated.access_token;
}

export function createRealEstateCalendarContext(accessToken: string): NodeContext {
  return {
    credentials: { google_calendar: { accessToken } },
    previousOutputs: {},
    logger: {
      info(message, meta) { console.info("[real-estate-calendar]", message, meta ?? {}); },
      error(message, meta) { console.error("[real-estate-calendar]", message, meta ?? {}); },
    },
    http: {
      async request(args) {
        const response = await fetch(args.url, {
          method: args.method,
          headers: args.headers,
          body: args.body === undefined ? undefined : JSON.stringify(args.body),
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(Math.max(1000, Math.min(args.timeoutMs ?? 15000, 20000))),
        });
        const raw = await response.text();
        let body: unknown = {};
        try { body = raw ? JSON.parse(raw) : {}; } catch { body = raw; }
        return { status: response.status, body };
      },
    },
  };
}

type CalendarEvent = {
  id?: string;
  status?: string;
  transparency?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
};

function eventInterval(event: CalendarEvent): { start: number; end: number } | null {
  const startValue = event.start?.dateTime ?? event.start?.date;
  const endValue = event.end?.dateTime ?? event.end?.date;
  if (!startValue || !endValue) return null;
  const start = Date.parse(startValue);
  const end = Date.parse(endValue);
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? { start, end } : null;
}

export async function assertRealEstateCalendarSlotAvailable(
  context: NodeContext,
  calendarId: string,
  startAt: string,
  endAt: string,
  excludeEventId?: string,
) {
  const operation = findOperation("google_calendar", "execute", "action");
  if (!operation) throw new Error("GOOGLE_CALENDAR_LIST_OPERATION_NOT_REGISTERED");
  const result = await operation.run(context, {
    calendarId,
    timeMin: new Date(Date.parse(startAt) - 86400000).toISOString(),
    timeMax: new Date(Date.parse(endAt) + 86400000).toISOString(),
    maxResults: 100,
  }) as { events?: CalendarEvent[] };
  for (const event of result.events ?? []) {
    if (excludeEventId && event.id === excludeEventId) continue;
    if (event.status === "cancelled" || event.transparency === "transparent") continue;
    const interval = eventInterval(event);
    if (interval && interval.start < Date.parse(endAt) && interval.end > Date.parse(startAt)) {
      return { available: false as const, conflictingEventId: event.id ?? null };
    }
  }
  return { available: true as const, conflictingEventId: null };
}
