import { z } from "zod";
import type { NodeDefinition, NodeContext } from "./types";

const email = z.string().email();
const required = (max = 3000) => z.string().trim().min(1).max(max);
function secret(ctx: NodeContext, provider: string, name: string) {
  const v = ctx.credentials[provider]?.[name];
  if (!v) throw new Error(provider.toUpperCase() + "_CONNECTION_REQUIRED");
  return v;
}
function assertOk(status: number, provider: string) {
  if (status < 200 || status >= 300) throw new Error(provider.toUpperCase() + (status === 429 ? "_RATE_LIMITED" : "_REQUEST_FAILED"));
}

export const emailMarketingExtraNodes: NodeDefinition[] = [
  {
    id: "beehiiv", name: "beehiiv", icon: "mail", category: "communication", version: 1,
    auth: { type: "apiKey", credentialKey: "apiKey" }, triggers: [], actions: [{
      id: "create_subscription", name: "Create subscription", description: "Adds an email address to a beehiiv publication. This changes subscription/marketing state; only use with documented consent and publication permissions.",
      inputSchema: z.object({ publicationId: required(100), email, reactivateExisting: z.boolean().default(false), sendWelcomeEmail: z.boolean().default(false), utmSource: z.string().max(100).optional() }).strict(),
      outputSchema: z.object({ subscriptionId: z.string(), status: z.string().optional() }).strict(),
      async run(ctx, raw) {
        const i = z.object({ publicationId: required(100), email, reactivateExisting: z.boolean().default(false), sendWelcomeEmail: z.boolean().default(false), utmSource: z.string().max(100).optional() }).strict().parse(raw);
        const r = await ctx.http.request({ url: "https://api.beehiiv.com/v2/publications/" + encodeURIComponent(i.publicationId) + "/subscriptions", method: "POST", headers: { Authorization: "Bearer " + secret(ctx, "beehiiv", "apiKey"), "Content-Type": "application/json" }, body: { email: i.email, reactivate_existing: i.reactivateExisting, send_welcome_email: i.sendWelcomeEmail, utm_source: i.utmSource }, timeoutMs: 15000, retries: 0 });
        assertOk(r.status, "beehiiv");
        const b = r.body as { data?: { id?: string; status?: string } };
        if (!b.data?.id) throw new Error("BEEHIIV_INVALID_RESPONSE");
        return { subscriptionId: b.data.id, status: b.data.status };
      },
    }],
  },
  {
    id: "activecampaign", name: "ActiveCampaign", icon: "users", category: "communication", version: 1,
    auth: { type: "connectionString", credentialKey: "accountApiUrl" }, triggers: [], actions: [{
      id: "sync_contact", name: "Sync contact", description: "ActiveCampaign account API URLs are tenant-specific. This action remains disabled until Aivanta's outbound HTTP gateway enforces public HTTPS DNS/IP validation, redirect blocking, and host pinning to prevent SSRF.",
      inputSchema: z.object({ email, firstName: z.string().max(100).optional(), lastName: z.string().max(100).optional() }).strict(),
      outputSchema: z.object({ contactId: z.string() }).strict(),
      async run() { throw new Error("ACTIVECAMPAIGN_ADAPTER_BLOCKED_UNTIL_SSRF_SAFE_EGRESS"); },
    }],
  },
];
