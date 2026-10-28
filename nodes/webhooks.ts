import { z } from "zod";
import type { NodeDefinition } from "./types";

const inputSchema = z.object({
  eventId: z.string().min(1).max(200),
  eventType: z.string().min(1).max(100),
  receivedAt: z.string().datetime(),
  payload: z.record(z.string(), z.unknown()),
}).strict();

const outputSchema = z.object({
  eventId: z.string(),
  eventType: z.string(),
  receivedAt: z.string().datetime(),
  payload: z.record(z.string(), z.unknown()),
}).strict();

export const webhooksNode: NodeDefinition = {
  id: "webhooks", name: "Webhooks", icon: "webhook", category: "triggers", version: 1,
  auth: { type: "none" },
  triggers: [{
    id: "receive_event",
    name: "Receive verified webhook event",
    description: "Starts a workflow from an inbound event after the ingress route has authenticated the request. eventType identifies the sender's event; payload contains its JSON data. Duplicate event IDs must be deduplicated by the dispatcher.",
    inputSchema, outputSchema,
    async run(ctx, input) {
      if (ctx.webhook?.verified !== true) throw new Error("WEBHOOK_SIGNATURE_NOT_VERIFIED");
      return outputSchema.parse(input);
    },
  }],
  actions: [],
};
