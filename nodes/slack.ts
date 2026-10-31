import { z } from "zod";
import type { NodeDefinition } from "./types";

const inputSchema = z.object({
  message: z.string().trim().min(1).max(4000).describe("Message text to post to the configured Slack incoming webhook."),
}).strict();
const outputSchema = z.object({ accepted: z.literal(true), status: z.number().int() }).strict();

export const slackNode: NodeDefinition = {
  id: "slack", name: "Slack", icon: "slack", category: "communication", version: 1,
  auth: { type: "apiKey", credentialKey: "webhookUrl" },
  triggers: [],
  actions: [{
    id: "send_message", name: "Send message",
    description: "Posts a message to a configured Slack incoming webhook. External side effect; requires a server-side connection.",
    inputSchema, outputSchema,
    async run(ctx, rawInput) {
      const input = inputSchema.parse(rawInput);
      const url = ctx.credentials.slack?.webhookUrl;
      if (!url) throw new Error("SLACK_CONNECTION_REQUIRED");
      let parsed: URL;
      try { parsed = new URL(url); } catch { throw new Error("SLACK_CONNECTION_INVALID"); }
      if (parsed.protocol !== "https:" || parsed.hostname !== "hooks.slack.com") throw new Error("SLACK_CONNECTION_INVALID");
      const response = await ctx.http.request({
        url: parsed.toString(), method: "POST",
        headers: { "Content-Type": "application/json" },
        body: { text: input.message }, timeoutMs: 10000, retries: 0,
      });
      if (response.status < 200 || response.status >= 300 || response.body !== "ok") {
        ctx.logger.error("Slack message failed", { status: response.status });
        throw new Error("SLACK_REQUEST_FAILED");
      }
      return outputSchema.parse({ accepted: true, status: response.status });
    },
  }],
};
