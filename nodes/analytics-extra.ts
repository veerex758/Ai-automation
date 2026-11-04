import { z } from "zod";
import type { NodeDefinition } from "./types";

const required = (max = 5000) => z.string().trim().min(1).max(max);
function credential(ctx: { credentials: Record<string, Record<string, string>> }, provider: string, name: string) {
  const value = ctx.credentials[provider]?.[name];
  if (!value) throw new Error(provider.toUpperCase() + "_CONNECTION_REQUIRED");
  return value;
}
function check(status: number, provider: string) {
  if (status < 200 || status >= 300) throw new Error(provider.toUpperCase() + (status === 429 ? "_RATE_LIMITED" : "_REQUEST_FAILED"));
}

export const analyticsExtraNodes: NodeDefinition[] = [
  {
    id: "google_analytics", name: "Google Analytics 4", icon: "chart-no-axes-combined", category: "data", version: 1,
    auth: { type: "apiKey", credentialKey: "measurementProtocolSecret" }, triggers: [], actions: [{
      id: "send_event", name: "Send GA4 event", description: "Sends an event through the GA4 Measurement Protocol. Requires a measurement ID and API secret; avoid personal or sensitive data. This sends analytics data externally.",
      inputSchema: z.object({ measurementId: z.string().regex(/^G-[A-Z0-9]+$/), clientId: required(200), eventName: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/), params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}) }).strict(),
      outputSchema: z.object({ accepted: z.boolean() }).strict(),
      async run(ctx, raw) {
        const i = z.object({ measurementId: z.string().regex(/^G-[A-Z0-9]+$/), clientId: required(200), eventName: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/), params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}) }).strict().parse(raw);
        const secret = credential(ctx, "google_analytics", "measurementProtocolSecret");
        const r = await ctx.http.request({ url: "https://www.google-analytics.com/mp/collect?measurement_id=" + encodeURIComponent(i.measurementId) + "&api_secret=" + encodeURIComponent(secret), method: "POST", headers: { "Content-Type": "application/json" }, body: { client_id: i.clientId, events: [{ name: i.eventName, params: i.params }] }, timeoutMs: 12000, retries: 0 });
        check(r.status, "google_analytics");
        return { accepted: true };
      },
    }],
  },
  {
    id: "tally", name: "Tally", icon: "clipboard-list", category: "communication", version: 1,
    auth: { type: "apiKey", credentialKey: "apiKey" }, triggers: [], actions: [{
      id: "get_form", name: "Get form", description: "Fetches metadata for a Tally form using a personal API key. Read-only operation.",
      inputSchema: z.object({ formId: required(100) }).strict(),
      outputSchema: z.object({ formId: z.string(), name: z.string().optional(), status: z.string().optional() }).strict(),
      async run(ctx, raw) {
        const i = z.object({ formId: required(100) }).strict().parse(raw);
        const r = await ctx.http.request({ url: "https://api.tally.so/forms/" + encodeURIComponent(i.formId), method: "GET", headers: { Authorization: "Bearer " + credential(ctx, "tally", "apiKey") }, timeoutMs: 12000, retries: 0 });
        check(r.status, "tally");
        const b = r.body as { id?: string; name?: string; status?: string };
        if (!b.id) throw new Error("TALLY_INVALID_RESPONSE");
        return { formId: b.id, name: b.name, status: b.status };
      },
    }],
  },
];
