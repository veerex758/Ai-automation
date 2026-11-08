import { z } from "zod";
import type { NodeDefinition } from "./types";

export const loopNode: NodeDefinition = {
  id: "loop",
  name: "Loop",
  icon: "repeat",
  category: "data",
  version: 1,
  auth: { type: "none" },
  triggers: [],
  actions: [{
    id: "iterate",
    name: "Prepare items for iteration",
    description: "Validates and exposes up to 100 items for downstream per-item execution. Attach loop metadata with this step as sourceStepId to every downstream action that should execute once per item.",
    inputSchema: z.object({ items: z.array(z.unknown()).max(100) }).strict(),
    outputSchema: z.object({ items: z.array(z.unknown()).max(100), count: z.number().int().min(0).max(100) }).strict(),
    async run(_ctx, raw) {
      const input = z.object({ items: z.array(z.unknown()).max(100) }).strict().parse(raw);
      return { items: input.items, count: input.items.length };
    },
  }],
};
