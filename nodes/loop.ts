import { z } from "zod";
import type { NodeDefinition, NodeContext } from "./types";
import { findOperation } from "./registry";

const subStepSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  nodeId: z.string().min(1).max(64),
  operationId: z.string().min(1).max(64),
  input: z.record(z.string(), z.unknown()),
}).strict();
const inputSchema = z.object({
  items: z.array(z.unknown()).min(1).max(100).describe("Records or rows to process, limited to 100 items per iteration."),
  steps: z.array(subStepSchema).min(1).max(10).describe("Actions to execute for each item, in order."),
  stopOnError: z.boolean().default(true),
}).strict();
const outputSchema = z.object({
  itemsProcessed: z.number().int().nonnegative(),
  itemsSucceeded: z.number().int().nonnegative(),
  itemsFailed: z.number().int().nonnegative(),
  results: z.array(z.object({
    index: z.number().int().nonnegative(),
    item: z.unknown(),
    status: z.enum(["succeeded", "failed"]),
    outputs: z.record(z.string(), z.unknown()),
    error: z.string().optional(),
  }).strict()),
}).strict();

function resolveItemReferences(value: unknown, item: unknown, index: number, outputs: Record<string, unknown>): unknown {
  if (typeof value === "string") {
    return value.replace(/\{\{(item|index|[a-zA-Z0-9_-]{1,64})(?:\.([a-zA-Z0-9_.-]{1,200}))?\}\}/g, (match, root: string, path?: string) => {
      let current: unknown;
      if (root === "index") current = index;
      else if (root === "item") current = item;
      else current = outputs[root];
      if (path) {
        for (const segment of path.split(".")) {
          if (!current || typeof current !== "object" || Array.isArray(current) ||
              !Object.prototype.hasOwnProperty.call(current, segment)) return match;
          current = (current as Record<string, unknown>)[segment];
        }
      }
      if (current === undefined || current === null) return match;
      return typeof current === "string" ? current : JSON.stringify(current);
    });
  }
  if (Array.isArray(value)) return value.map((part) => resolveItemReferences(part, item, index, outputs));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, part]) => [key, resolveItemReferences(part, item, index, outputs)]));
  }
  return value;
}

export const loopNode: NodeDefinition = {
  id: "loop", name: "Loop / Iterate", icon: "repeat-2", category: "data", version: 1,
  auth: { type: "none" }, triggers: [],
  actions: [{
    id: "for_each", name: "For each item",
    description: "Runs up to 10 configured registered actions for each of up to 100 input records. Reference the current record with {{item.email}}, its zero-based position with {{index}}, and previous loop-action outputs with {{stepId.field}}. External live actions remain disabled until separately approved.",
    inputSchema, outputSchema,
    async run(ctx: NodeContext, raw) {
      const input = inputSchema.parse(raw);
      const seen = new Set<string>();
      for (const step of input.steps) {
        if (seen.has(step.id)) throw new Error("LOOP_DUPLICATE_STEP_ID");
        seen.add(step.id);
        const operation = findOperation(step.nodeId, step.operationId, "action");
        if (!operation) throw new Error("LOOP_OPERATION_NOT_FOUND");
        if (step.nodeId === "loop") throw new Error("LOOP_NESTING_NOT_SUPPORTED");
        if (!operation.inputSchema.safeParse(step.input).success &&
            !JSON.stringify(step.input).includes("{{")) {
          throw new Error("LOOP_STEP_INPUT_INVALID");
        }
      }

      const results: Array<{ index: number; item: unknown; status: "succeeded" | "failed"; outputs: Record<string, unknown>; error?: string }> = [];
      let itemsSucceeded = 0;
      let itemsFailed = 0;
      for (let index = 0; index < input.items.length; index += 1) {
        const item = input.items[index];
        const outputs: Record<string, unknown> = {};
        let errorCode: string | undefined;
        for (const step of input.steps) {
          try {
            const operation = findOperation(step.nodeId, step.operationId, "action");
            if (!operation) throw new Error("LOOP_OPERATION_NOT_FOUND");
            const resolved = resolveItemReferences(step.input, item, index, outputs);
            const validated = operation.inputSchema.parse(resolved);
            const result = await operation.run({ ...ctx, previousOutputs: { ...ctx.previousOutputs, item, index, ...outputs } }, validated);
            outputs[step.id] = operation.outputSchema.parse(result);
          } catch (error) {
            errorCode = error instanceof Error ? error.message : "LOOP_ITEM_FAILED";
            break;
          }
        }
        if (errorCode) {
          itemsFailed += 1;
          results.push({ index, item, status: "failed", outputs, error: errorCode });
          if (input.stopOnError) break;
        } else {
          itemsSucceeded += 1;
          results.push({ index, item, status: "succeeded", outputs });
        }
      }
      return outputSchema.parse({ itemsProcessed: results.length, itemsSucceeded, itemsFailed, results });
    },
  }],
};
