import { z } from "zod";
import type { NodeDefinition, NodeContext } from "./types";

const nonempty = (max = 5000) => z.string().trim().min(1).max(max);
function credential(ctx: NodeContext, provider: string, key: string) {
  const value = ctx.credentials[provider]?.[key];
  if (!value || value.length > 4096 || value.includes("\r") || value.includes("\n")) throw new Error(provider.toUpperCase() + "_CONNECTION_REQUIRED");
  return value;
}
function assertSuccess(status: number, provider: string) {
  if (status < 200 || status >= 300) throw new Error(provider.toUpperCase() + (status === 429 ? "_RATE_LIMITED" : "_REQUEST_FAILED"));
}
function basic(value: string) {
  return "Basic " + Buffer.from(value + ":").toString("base64");
}

export const crmMarketingNodes: NodeDefinition[] = [
  {
    id: "klaviyo", name: "Klaviyo", icon: "mail", category: "communication", version: 1,
    auth: { type: "apiKey", credentialKey: "privateApiKey" }, triggers: [], actions: [{
      id: "create_profile", name: "Create or update profile", description: "Creates a Klaviyo profile using a private API key with profile write permission. This changes marketing profile data; ensure the contact has an appropriate lawful basis and consent.",
      inputSchema: z.object({ email: z.string().email(), firstName: z.string().max(100).optional(), lastName: z.string().max(100).optional(), phoneNumber: z.string().max(30).optional() }).strict(),
      outputSchema: z.object({ profileId: z.string() }).strict(),
      async run(ctx, raw) {
        const i = z.object({ email: z.string().email(), firstName: z.string().max(100).optional(), lastName: z.string().max(100).optional(), phoneNumber: z.string().max(30).optional() }).strict().parse(raw);
        const attributes: Record<string, string> = { email: i.email };
        if (i.firstName) attributes.first_name = i.firstName;
        if (i.lastName) attributes.last_name = i.lastName;
        if (i.phoneNumber) attributes.phone_number = i.phoneNumber;
        const r = await ctx.http.request({ url: "https://a.klaviyo.com/api/profiles/", method: "POST", headers: { Authorization: "Klaviyo-API-Key " + credential(ctx, "klaviyo", "privateApiKey"), "Content-Type": "application/json", revision: "2025-01-15" }, body: { data: { type: "profile", attributes } }, timeoutMs: 15000, retries: 0 });
        assertSuccess(r.status, "klaviyo");
        const b = r.body as { data?: { id?: string } };
        if (!b.data?.id) throw new Error("KLAVIYO_INVALID_RESPONSE");
        return { profileId: b.data.id };
      },
    }],
  },
  {
    id: "lemlist", name: "Lemlist", icon: "send", category: "communication", version: 1,
    auth: { type: "apiKey", credentialKey: "apiKey" }, triggers: [], actions: [{
      id: "create_lead", name: "Create lead", description: "Adds a lead to a Lemlist campaign using the connected API key. Campaign membership can trigger outreach; verify consent and campaign settings first.",
      inputSchema: z.object({ campaignId: nonempty(100), email: z.string().email(), firstName: z.string().max(100).optional(), lastName: z.string().max(100).optional() }).strict(),
      outputSchema: z.object({ leadId: z.string(), email: z.string().email() }).strict(),
      async run(ctx, raw) {
        const i = z.object({ campaignId: nonempty(100), email: z.string().email(), firstName: z.string().max(100).optional(), lastName: z.string().max(100).optional() }).strict().parse(raw);
        const params = new URLSearchParams({ email: i.email });
        if (i.firstName) params.set("firstName", i.firstName);
        if (i.lastName) params.set("lastName", i.lastName);
        const r = await ctx.http.request({ url: "https://api.lemlist.com/api/campaigns/" + encodeURIComponent(i.campaignId) + "/leads?" + params.toString(), method: "POST", headers: { Authorization: basic(credential(ctx, "lemlist", "apiKey")) }, timeoutMs: 15000, retries: 0 });
        assertSuccess(r.status, "lemlist");
        const b = r.body as { _id?: string; email?: string };
        if (!b._id) throw new Error("LEMLIST_INVALID_RESPONSE");
        return { leadId: b._id, email: b.email ?? i.email };
      },
    }],
  },
  {
    id: "customer_io", name: "Customer.io", icon: "users", category: "communication", version: 1,
    auth: { type: "apiKey", credentialKey: "siteId" }, triggers: [], actions: [{
      id: "identify_customer", name: "Identify customer", description: "Creates or updates a Customer.io customer profile using the Track API. This changes customer data; use a stable customer ID and only permitted attributes.",
      inputSchema: z.object({ customerId: nonempty(200), email: z.string().email().optional(), attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}) }).strict(),
      outputSchema: z.object({ customerId: z.string(), accepted: z.boolean() }).strict(),
      async run(ctx, raw) {
        const i = z.object({ customerId: nonempty(200), email: z.string().email().optional(), attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}) }).strict().parse(raw);
        const siteId = credential(ctx, "customer_io", "siteId");
        const apiKey = credential(ctx, "customer_io", "apiKey");
        const r = await ctx.http.request({ url: "https://track.customer.io/api/v1/customers/" + encodeURIComponent(i.customerId), method: "POST", headers: { Authorization: basic(siteId + ":" + apiKey), "Content-Type": "application/json" }, body: { ...i.attributes, ...(i.email ? { email: i.email } : {}) }, timeoutMs: 15000, retries: 0 });
        assertSuccess(r.status, "customer_io");
        return { customerId: i.customerId, accepted: true };
      },
    }],
  },
];
