import { z } from "zod";
import type { NodeDefinition } from "./types";

/** Event adapter for the durable scheduler: the scheduler, not this node, owns timing and leases. */
export const scheduleTriggerNode: NodeDefinition = {
  id: "schedule", name: "Schedule / Cron Trigger", icon: "calendar-clock", category: "triggers", version: 1,
  auth: { type: "none" }, actions: [], triggers: [{
    id: "tick", name: "Scheduled occurrence", description: "Accepts a scheduler-claimed occurrence. Timing, cron/interval evaluation, lease ownership and idempotency are enforced by the durable scheduler service.",
    inputSchema: z.object({ scheduleId: z.string().uuid(), occurrenceId: z.string().min(1).max(128), scheduledAt: z.string().datetime(), payload: z.record(z.string(), z.json()).default({}) }).strict(),
    outputSchema: z.object({ scheduleId: z.string(), occurrenceId: z.string(), scheduledAt: z.string(), payload: z.record(z.string(), z.json()) }).strict(),
    async run(_ctx, input) { return input; },
  }],
};