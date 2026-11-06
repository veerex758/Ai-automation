export type ProviderPackStep = { kind: "trigger" | "action"; nodeId: string; operationId: string };

export const PROVIDER_PACK_LIVE_IDS = [
  "claude", "mistral", "groq", "perplexity", "discord", "telegram", "whatsapp_business",
  "sendgrid", "mailgun", "postmark", "github", "gitlab", "sentry", "vercel", "calendly",
  "zendesk", "freshdesk", "serpapi", "openweather", "rss_feed",
] as const;

const providerPackIds = new Set<string>(PROVIDER_PACK_LIVE_IDS);

export function providerPackLiveId(step: ProviderPackStep): string | null {
  return step.kind === "action" && /^[a-z][a-z0-9_]{0,63}$/.test(step.operationId) && providerPackIds.has(step.nodeId)
    ? step.nodeId
    : null;
}

/** A provider is live only when its exact ID is explicitly opted in. */
export function isProviderLiveEnabled(provider: string, configured: string | undefined): boolean {
  return new Set((configured ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean)).has(provider);
}
