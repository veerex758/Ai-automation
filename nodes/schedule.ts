import { z } from "zod";
import type { NodeDefinition } from "./types";

const scheduledInput = z.object({
  scheduledAt: z.string().datetime(),
  timezone: z.string().min(1).max(100).default("UTC"),
  cronExpression: z.string().min(9).max(100),
}).strict();

export const scheduleNode: NodeDefinition = {
  id: "schedule",
  name: "Schedule/Cron",
  icon: "calendar-clock",
  category: "triggers",
  version: 1,
  auth: { type: "none" },
  triggers: [{
    id: "scheduled",
    name: "Scheduled trigger",
    description: "Starts a workflow from a persisted timezone-aware cron schedule. The scheduler dispatches the event through the durable execution queue.",
    inputSchema: scheduledInput,
    outputSchema: scheduledInput,
    async run(_ctx, raw) {
      return scheduledInput.parse(raw);
    },
  }],
  actions: [],
};
