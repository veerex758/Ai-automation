import { z } from "zod";
import type { NodeDefinition } from "./types";

const inputSchema = z.object({}).passthrough();
const outputSchema = z.object({ started: z.literal(true) }).strict();

/** Manual trigger used to bridge the existing version-1 workflow builder to the node registry. */
export const manualNode: NodeDefinition = {
  id: "manual", name: "Manual trigger", icon: "play", category: "triggers", version: 1,
  auth: { type: "none" },
  triggers: [{
    id: "start", name: "Start manually",
    description: "Starts a workflow from an explicit user action. Does not create a schedule or webhook subscription.",
    inputSchema, outputSchema,
    async run(_ctx, rawInput) {
      inputSchema.parse(rawInput);
      return outputSchema.parse({ started: true });
    },
  }],
  actions: [],
};
