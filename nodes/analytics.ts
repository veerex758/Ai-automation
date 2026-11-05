import { z } from "zod";
import type { NodeDefinition, NodeContext } from "./types";

const text = (max = 10000) => z.string().trim().min(1).max(max);
function key(ctx: NodeContext, provider: string, name = "apiKey") {
  const value = ctx.credentials[provider]?.[name];
  if (!value || value.length > 4096 || value.includes("\r") || value.includes("\n")) throw new Error(provider.toUpperCase() + "_CONNECTION_REQUIRED");
  return value;
}
function success(status: number, provider: string) {
  if (status < 200 || status >= 300) throw new Error(provider.toUpperCase() + (status === 429 ? "_RATE_LIMITED" : "_REQUEST_FAILED"));
}
function basic(value: string) { return "Basic " + Buffer.from(value + ":").toString("base64"); }

export const analyticsNodes: NodeDefinition[] = [
  {
    id: "mixpanel", name: "Mixpanel", icon: "chart-no-axes-combined", category: "data", version: 1,
    auth: { type: "apiKey", credentialKey: "projectToken" }, triggers: [], actions: [{
      id: "track_event", name: "Track event", description: "Sends a single event to Mixpanel using the connected project token. Avoid sending unnecessary personal or sensitive data.",
      inputSchema: z.object({ event: text(200), distinctId: text(200), properties: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}), time: z.number().int().positive().optional() }).strict(),
      outputSchema: z.object({ accepted: z.boolean(), status: z.string() }).strict(),
      async run(ctx, raw) {
        const i = z.object({ event: text(200), distinctId: text(200), properties: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}), time: z.number().int().positive().optional() }).strict().parse(raw);
        const payload = Buffer.from(JSON.stringify({ event: i.event, properties: { ...i.properties, distinct_id: i.distinctId, ...(i.time ? { time: i.time } : {}) } })).toString("base64");
        const r = await ctx.http.request({ url: "https://api.mixpanel.com/track?ip=0", method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ data: payload, strict: "1", project_token: key(ctx, "mixpanel", "projectToken") }).toString(), timeoutMs: 12000, retries: 0 });
        success(r.status, "mixpanel");
        if (r.body !== 1 && r.body !== "1" && (r.body as { status?: number })?.status !== 1) throw new Error("MIXPANEL_EVENT_NOT_ACCEPTED");
        return { accepted: true, status: "accepted" };
      },
    }],
  },
  {
    id: "posthog", name: "PostHog", icon: "chart-line", category: "data", version: 1,
    auth: { type: "apiKey", credentialKey: "projectApiKey" }, triggers: [], actions: [{
      id: "capture_event", name: "Capture event", description: "Captures an event in PostHog's US cloud endpoint using a project API key. EU/self-hosted deployments require a separately reviewed regional adapter.",
      inputSchema: z.object({ event: text(200), distinctId: text(200), properties: z.record(z.string(), z.json()).default({}) }).strict(),
      outputSchema: z.object({ accepted: z.boolean() }).strict(),
      async run(ctx, raw) {
        const i = z.object({ event: text(200), distinctId: text(200), properties: z.record(z.string(), z.json()).default({}) }).strict().parse(raw);
        const r = await ctx.http.request({ url: "https://us.i.posthog.com/i/v1/capture/", method: "POST", headers: { "Content-Type": "application/json" }, body: { api_key: key(ctx, "posthog", "projectApiKey"), event: i.event, distinct_id: i.distinctId, properties: i.properties }, timeoutMs: 12000, retries: 0 });
        success(r.status, "posthog");
        return { accepted: true };
      },
    }],
  },
  {
    id: "segment", name: "Segment", icon: "chart-pie", category: "data", version: 1,
    auth: { type: "apiKey", credentialKey: "writeKey" }, triggers: [], actions: [{
      id: "track_event", name: "Track event", description: "Sends a Segment Track event with a connected source write key. Keep event properties free of unnecessary personal or sensitive data.",
      inputSchema: z.object({ userId: text(200).optional(), anonymousId: text(200).optional(), event: text(200), properties: z.record(z.string(), z.json()).default({}) }).strict().refine(v => Boolean(v.userId || v.anonymousId), "userId or anonymousId is required"),
      outputSchema: z.object({ accepted: z.boolean() }).strict(),
      async run(ctx, raw) {
        const i = z.object({ userId: text(200).optional(), anonymousId: text(200).optional(), event: text(200), properties: z.record(z.string(), z.json()).default({}) }).strict().refine(v => Boolean(v.userId || v.anonymousId)).parse(raw);
        const r = await ctx.http.request({ url: "https://api.segment.io/v1/track", method: "POST", headers: { Authorization: basic(key(ctx, "segment", "writeKey")), "Content-Type": "application/json" }, body: { userId: i.userId, anonymousId: i.anonymousId, event: i.event, properties: i.properties }, timeoutMs: 12000, retries: 0 });
        success(r.status, "segment");
        return { accepted: true };
      },
    }],
  },
  {
    id: "datadog", name: "Datadog", icon: "activity", category: "data", version: 1,
    auth: { type: "apiKey", credentialKey: "apiKey" }, triggers: [], actions: [{
      id: "submit_log", name: "Submit log", description: "Submits a structured log to Datadog's US1 intake endpoint. Other Datadog sites need a separately configured regional adapter. Do not include secrets or personal data.",
      inputSchema: z.object({ message: text(10000), service: text(200), status: z.enum(["emergency", "alert", "critical", "error", "warning", "notice", "info", "debug"]).default("info"), attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}) }).strict(),
      outputSchema: z.object({ accepted: z.boolean() }).strict(),
      async run(ctx, raw) {
        const i = z.object({ message: text(10000), service: text(200), status: z.enum(["emergency", "alert", "critical", "error", "warning", "notice", "info", "debug"]).default("info"), attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}) }).strict().parse(raw);
        const r = await ctx.http.request({ url: "https://http-intake.logs.datadoghq.com/api/v2/logs", method: "POST", headers: { "DD-API-KEY": key(ctx, "datadog"), "Content-Type": "application/json" }, body: [{ message: i.message, service: i.service, status: i.status, ...i.attributes }], timeoutMs: 12000, retries: 0 });
        success(r.status, "datadog");
        return { accepted: true };
      },
    }],
  },
];
