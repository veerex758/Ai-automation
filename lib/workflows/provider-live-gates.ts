export type ProviderPackStep = { kind: "trigger" | "action"; nodeId: string; operationId: string };

export const PROVIDER_PACK_LIVE_IDS = [
  "claude", "mistral", "groq", "perplexity", "discord", "telegram", "whatsapp_business",
  "sendgrid", "mailgun", "postmark", "github", "gitlab", "sentry", "vercel", "calendly",
  "zendesk", "freshdesk", "serpapi", "openweather", "rss_feed",
] as const;

const providerPackIds = new Set<string>(PROVIDER_PACK_LIVE_IDS);
const providerPackOperations: Readonly<Record<string, ReadonlySet<string>>> = {
  discord: new Set(["execute", "get_channel"]),
  telegram: new Set(["execute", "get_chat"]),
  whatsapp_business: new Set(["execute", "get_phone_number"]),
};

export function providerPackLiveId(step: ProviderPackStep): string | null {
  if (step.kind !== "action" || !providerPackIds.has(step.nodeId)) return null;
  const allowed = providerPackOperations[step.nodeId] ?? new Set(["execute"]);
  return allowed.has(step.operationId) ? step.nodeId : null;
}

/** A provider is live only when its exact ID is explicitly opted in. */
export function isProviderLiveEnabled(provider: string, configured: string | undefined): boolean {
  return new Set((configured ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean)).has(provider);
}
