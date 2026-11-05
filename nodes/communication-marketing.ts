import { z } from "zod";
import type { NodeDefinition, NodeContext } from "./types";

const required = (max = 4000) => z.string().trim().min(1).max(max);
function secret(ctx: NodeContext, provider: string, key = "apiKey") {
  const value = ctx.credentials[provider]?.[key];
  if (!value || value.length > 4096 || value.includes("\\r") || value.includes("\\n")) throw new Error(provider.toUpperCase() + "_CONNECTION_REQUIRED");
  return value;
}
function headers(token: string) {
  return { Authorization: "Bearer " + token, "Content-Type": "application/json" };
}
function ok(status: number, provider: string) {
  if (status < 200 || status >= 300) throw new Error(provider.toUpperCase() + (status === 429 ? "_RATE_LIMITED" : "_REQUEST_FAILED"));
}

export const communicationMarketingNodes: NodeDefinition[] = [
  {
    id: "messagebird", name: "MessageBird", icon: "message-circle", category: "communication", version: 1,
    auth: { type: "apiKey", credentialKey: "accessKey" }, triggers: [], actions: [{
      id: "send_sms", name: "Send SMS", description: "Sends an SMS through MessageBird using a connected access key. The originator must be approved for the destination. External side effect.",
      inputSchema: z.object({ originator: required(11), recipient: z.string().regex(/^\+?[1-9]\d{6,14}$/), body: required(1600) }).strict(),
      outputSchema: z.object({ messageId: z.string(), status: z.string() }).strict(),
      async run(ctx, raw) {
        const i = z.object({ originator: required(11), recipient: z.string().regex(/^\+?[1-9]\d{6,14}$/), body: required(1600) }).strict().parse(raw);
        const r = await ctx.http.request({ url: "https://rest.messagebird.com/messages", method: "POST", headers: { Authorization: "AccessKey " + secret(ctx, "messagebird", "accessKey"), "Content-Type": "application/json" }, body: { originator: i.originator, recipients: [i.recipient.replace(/^\+/, "")], body: i.body }, timeoutMs: 15000, retries: 0 });
        ok(r.status, "messagebird");
        const b = r.body as { id?: string; recipients?: { items?: Array<{ status?: string }> } };
        if (!b.id) throw new Error("MESSAGEBIRD_INVALID_RESPONSE");
        return { messageId: b.id, status: b.recipients?.items?.[0]?.status ?? "accepted" };
      },
    }],
  },
  {
    id: "vonage_sms", name: "Vonage SMS", icon: "message-circle", category: "communication", version: 1,
    auth: { type: "apiKey", credentialKey: "apiKey" }, triggers: [], actions: [{
      id: "send_sms", name: "Send SMS", description: "Sends an SMS through Vonage Messages API using an API key and secret. Requires an approved sender ID where applicable. External side effect.",
      inputSchema: z.object({ from: required(18), to: z.string().regex(/^\+?[1-9]\d{6,14}$/), text: required(1000) }).strict(),
      outputSchema: z.object({ messageUuid: z.string(), status: z.string() }).strict(),
      async run(ctx, raw) {
        const i = z.object({ from: required(18), to: z.string().regex(/^\+?[1-9]\d{6,14}$/), text: required(1000) }).strict().parse(raw);
        const apiKey = secret(ctx, "vonage_sms", "apiKey");
        const apiSecret = secret(ctx, "vonage_sms", "apiSecret");
        const r = await ctx.http.request({ url: "https://rest.nexmo.com/sms/json", method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ api_key: apiKey, api_secret: apiSecret, from: i.from, to: i.to.replace(/^\+/, ""), text: i.text }).toString(), timeoutMs: 15000, retries: 0 });
        ok(r.status, "vonage_sms");
        const b = r.body as { messages?: Array<{ "message-id"?: string; status?: string }> };
        const m = b.messages?.[0];
        if (!m?.["message-id"] || m.status !== "0") throw new Error("VONAGE_SMS_REJECTED");
        return { messageUuid: m["message-id"], status: m.status };
      },
    }],
  },
  {
    id: "brevo", name: "Brevo", icon: "mail", category: "communication", version: 1,
    auth: { type: "apiKey", credentialKey: "apiKey" }, triggers: [], actions: [{
      id: "send_transactional_email", name: "Send transactional email", description: "Sends transactional email through Brevo. The sender must be verified in the Brevo account. External side effect.",
      inputSchema: z.object({ senderEmail: z.string().email(), senderName: z.string().max(100).optional(), to: z.array(z.object({ email: z.string().email(), name: z.string().max(100).optional() }).strict()).min(1).max(50), subject: required(200), htmlContent: required(30000) }).strict(),
      outputSchema: z.object({ messageId: z.string() }).strict(),
      async run(ctx, raw) {
        const i = z.object({ senderEmail: z.string().email(), senderName: z.string().max(100).optional(), to: z.array(z.object({ email: z.string().email(), name: z.string().max(100).optional() }).strict()).min(1).max(50), subject: required(200), htmlContent: required(30000) }).strict().parse(raw);
        const r = await ctx.http.request({ url: "https://api.brevo.com/v3/smtp/email", method: "POST", headers: { "api-key": secret(ctx, "brevo"), "Content-Type": "application/json" }, body: { sender: { email: i.senderEmail, name: i.senderName }, to: i.to, subject: i.subject, htmlContent: i.htmlContent }, timeoutMs: 15000, retries: 0 });
        ok(r.status, "brevo");
        const b = r.body as { messageId?: string };
        if (!b.messageId) throw new Error("BREVO_INVALID_RESPONSE");
        return { messageId: b.messageId };
      },
    }],
  },
  {
    id: "convertkit", name: "Kit (ConvertKit)", icon: "mail", category: "communication", version: 1,
    auth: { type: "apiKey", credentialKey: "apiSecret" }, triggers: [], actions: [{
      id: "add_subscriber_to_form", name: "Add subscriber to form", description: "Subscribes an email address to a Kit form. Confirm consent and applicable marketing permissions before use. This changes subscriber marketing state.",
      inputSchema: z.object({ formId: z.string().regex(/^\d{1,20}$/), email: z.string().email(), firstName: z.string().max(100).optional() }).strict(),
      outputSchema: z.object({ subscriberId: z.number().int().positive() }).strict(),
      async run(ctx, raw) {
        const i = z.object({ formId: z.string().regex(/^\d{1,20}$/), email: z.string().email(), firstName: z.string().max(100).optional() }).strict().parse(raw);
        const r = await ctx.http.request({ url: "https://api.kit.com/v4/forms/" + i.formId + "/subscribers", method: "POST", headers: headers(secret(ctx, "convertkit", "apiSecret")), body: { email_address: i.email, first_name: i.firstName }, timeoutMs: 15000, retries: 0 });
        ok(r.status, "convertkit");
        const b = r.body as { subscriber?: { id?: number } };
        if (!b.subscriber?.id) throw new Error("CONVERTKIT_INVALID_RESPONSE");
        return { subscriberId: b.subscriber.id };
      },
    }],
  },
];
