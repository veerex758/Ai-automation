import { z } from "zod";
import type { NodeDefinition } from "./types";

const webhookInput = z.object({
  message: z.string().trim().min(1).max(4000),
}).strict();
const webhookOutput = z.object({ accepted: z.literal(true), status: z.number().int() }).strict();
const apiInput = z.object({
  channel: z.string().trim().min(1).max(120),
  message: z.string().trim().min(1).max(4000),
}).strict();
const apiOutput = z.object({ accepted: z.literal(true), channel: z.string(), timestamp: z.string() }).strict();

export const slackNode: NodeDefinition = {
  id: "slack", name: "Slack", icon: "slack", category: "communication", version: 2,
  auth: { type: "apiKey", credentialKey: "botToken" },
  triggers: [],
  actions: [
    {
      id: "send_message", name: "Send webhook message",
      description: "Posts a message to a configured Slack incoming webhook. External side effect; requires a server-side webhook connection.",
      inputSchema: webhookInput, outputSchema: webhookOutput,
      async run(ctx, rawInput) {
        const input = webhookInput.parse(rawInput);
        const url = ctx.credentials.slack?.webhookUrl;
        if (!url) throw new Error("SLACK_CONNECTION_REQUIRED");
        let parsed: URL;
        try { parsed = new URL(url); } catch { throw new Error("SLACK_CONNECTION_INVALID"); }
        if (parsed.protocol !== "https:" || parsed.hostname !== "hooks.slack.com") throw new Error("SLACK_CONNECTION_INVALID");
        const response = await ctx.http.request({
          url: parsed.toString(), method: "POST",
          headers: { "Content-Type": "application/json" }, body: { text: input.message },
          timeoutMs: 10000, retries: 0,
        });
        if (response.status < 200 || response.status >= 300 || response.body !== "ok") {
          ctx.logger.error("Slack webhook failed", { status: response.status });
          throw new Error("SLACK_REQUEST_FAILED");
        }
        return webhookOutput.parse({ accepted: true, status: response.status });
      },
    },
    {
      id: "post_message", name: "Post channel message",
      description: "Posts a message to a selected Slack channel using a workspace bot token with chat:write permission. Live execution requires the slack provider to be explicitly enabled by the server.",
      inputSchema: apiInput, outputSchema: apiOutput,
      async run(ctx, rawInput) {
        const input = apiInput.parse(rawInput);
        const token = ctx.credentials.slack?.botToken;
        if (!token) throw new Error("SLACK_BOT_CONNECTION_REQUIRED");
        const response = await ctx.http.request({
          url: "https://slack.com/api/chat.postMessage", method: "POST",
          headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
          body: { channel: input.channel, text: input.message }, timeoutMs: 12000, retries: 0,
        });
        if (response.status < 200 || response.status >= 300) throw new Error("SLACK_REQUEST_FAILED");
        const body = response.body as { ok?: unknown; channel?: unknown; ts?: unknown; error?: unknown };
        if (body?.ok !== true || typeof body.channel !== "string" || typeof body.ts !== "string") {
          ctx.logger.error("Slack API rejected message", { error: typeof body?.error === "string" ? body.error : "unknown" });
          throw new Error("SLACK_API_REJECTED");
        }
        return apiOutput.parse({ accepted: true, channel: body.channel, timestamp: body.ts });
      },
    },
  ],
};
