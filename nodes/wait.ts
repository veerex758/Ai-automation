import { z } from "zod";
import type { NodeDefinition } from "./types";

export const waitNode: NodeDefinition = {
  id: "wait",
  name: "Wait",
  icon: "timer",
  category: "developer",
  version: 1,
  auth: { type: "none" },
  triggers: [],
  actions: [{
    id: "delay",
    name: "Wait before continuing",
    description: "Requests a durable workflow pause. The execution worker checkpoints this step and releases the queue lease until the requested resume time; it does not sleep inside a server process.",
    inputSchema: z.object({
      durationMs: z.number().int().min(1000).max(2592000000),
    }).strict(),
    outputSchema: z.object({
      waitMs: z.number().int().min(1000).max(2592000000),
      resumeAt: z.string().datetime(),
    }).strict(),
    async run(_ctx, raw) {
      const input = z.object({ durationMs: z.number().int().min(1000).max(2592000000) }).strict().parse(raw);
      return { waitMs: input.durationMs, resumeAt: new Date(Date.now() + input.durationMs).toISOString() };
    },
  }],
};
