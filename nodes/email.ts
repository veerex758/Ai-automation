import { z } from "zod";
import type { NodeDefinition } from "./types";

const inputSchema = z.object({
  to: z.string().email().max(254),
  subject: z.string().trim().min(1).max(200),
  text: z.string().trim().min(1).max(10000),
}).strict();
const outputSchema = z.object({ accepted: z.literal(true), messageId: z.string().min(1), provider: z.literal("resend") }).strict();

export const emailNode: NodeDefinition = {
  id: "email", name: "Email", icon: "mail", category: "communication", version: 1,
  auth: { type: "apiKey", credentialKey: "apiKey" },
  triggers: [],
  actions: [{
    id: "send_email", name: "Send email",
    description: "Sends a real email through Resend. Requires a configured sender and a server-side API key; external side effect and may incur charges.",
    inputSchema, outputSchema,
    async run(ctx, rawInput) {
      const input = inputSchema.parse(rawInput);
      const apiKey = ctx.credentials.resend?.apiKey;
      const from = ctx.credentials.resend?.fromEmail;
      if (!apiKey || !from) throw new Error("EMAIL_CONNECTION_REQUIRED");
      const response = await ctx.http.request({
        url: "https://api.resend.com/emails", method: "POST",
        headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
        body: { from, to: [input.to], subject: input.subject, text: input.text },
        timeoutMs: 15000, retries: 0,
      });
      if (response.status < 200 || response.status >= 300) {
        ctx.logger.error("Resend email failed", { status: response.status });
        throw new Error(response.status === 429 ? "EMAIL_RATE_LIMITED" : "EMAIL_REQUEST_FAILED");
      }
      const body = response.body as { id?: unknown };
      if (typeof body?.id !== "string" || !body.id) throw new Error("EMAIL_PROVIDER_RESULT_INVALID");
      return outputSchema.parse({ accepted: true, messageId: body.id, provider: "resend" });
    },
  }],
};
