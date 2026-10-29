import { z } from "zod";
import type { NodeDefinition } from "./types";

const mapInput = z.object({
  data: z.record(z.string(), z.unknown()).describe("Input object whose fields can be mapped."),
  fields: z.record(z.string().trim().min(1), z.string().trim().min(1)).describe("Output field name to dot-separated source path mapping."),
}).strict();
const mapOutput = z.object({ data: z.record(z.string(), z.unknown()) }).strict();
const templateInput = z.object({
  template: z.string().max(12000).describe("Text with placeholders such as {{customer.name}}."),
  data: z.record(z.string(), z.unknown()).describe("Values available to template placeholders."),
}).strict();
const templateOutput = z.object({ text: z.string() }).strict();

function readPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[key];
  }, value);
}
function stringify(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try { return JSON.stringify(value) ?? ""; } catch { return ""; }
}

export const dataNode: NodeDefinition = {
  id: "data", name: "Data", icon: "workflow", category: "data", version: 1,
  auth: { type: "none" }, triggers: [],
  actions: [
    {
      id: "map_fields", name: "Map fields",
      description: "Creates a new object by mapping chosen output field names to dot-separated paths in an input object. Missing paths become null, input data is not mutated, and no external service is called.",
      inputSchema: mapInput, outputSchema: mapOutput,
      async run(_ctx, rawInput) {
        const input = mapInput.parse(rawInput);
        const data: Record<string, unknown> = {};
        for (const [target, source] of Object.entries(input.fields)) {
          data[target] = readPath(input.data, source) ?? null;
        }
        return mapOutput.parse({ data });
      },
    },
    {
      id: "format_text", name: "Format text",
      description: "Renders a text template using values from an input object. Supports placeholders like {{customer.name}}; missing values become empty strings and object values are JSON-encoded.",
      inputSchema: templateInput, outputSchema: templateOutput,
      async run(_ctx, rawInput) {
        const input = templateInput.parse(rawInput);
        const text = input.template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, path: string) => stringify(readPath(input.data, path)));
        return templateOutput.parse({ text });
      },
    },
    {
      id: "deduplicate_items", name: "Deduplicate items",
      description: "Removes duplicate primitive values or records by stable JSON value, or by a selected dot-separated key path. Preserves first-seen order and does not mutate input items.",
      inputSchema: z.object({
        items: z.array(z.unknown()).max(5000),
        key: z.string().trim().min(1).max(200).optional(),
      }).strict(),
      outputSchema: z.object({ items: z.array(z.unknown()), count: z.number().int().nonnegative(), removed: z.number().int().nonnegative() }).strict(),
      async run(_ctx, rawInput) {
        const input = z.object({ items: z.array(z.unknown()).max(5000), key: z.string().trim().min(1).max(200).optional() }).strict().parse(rawInput);
        const seen = new Set<string>();
        const items: unknown[] = [];
        for (const item of input.items) {
          const value = input.key ? readPath(item, input.key) : item;
          let identity: string;
          try { identity = JSON.stringify(value) ?? String(value); } catch { throw new Error("DATA_DEDUPE_VALUE_INVALID"); }
          if (seen.has(identity)) continue;
          seen.add(identity);
          items.push(item);
        }
        return { items, count: items.length, removed: input.items.length - items.length };
      },
    },
    {
      id: "sort_items", name: "Sort items",
      description: "Sorts up to 5,000 primitive values or records by an optional dot-separated field. Supports ascending or descending order and stable ordering for equal values.",
      inputSchema: z.object({
        items: z.array(z.unknown()).max(5000),
        key: z.string().trim().min(1).max(200).optional(),
        direction: z.enum(["asc", "desc"]).default("asc"),
      }).strict(),
      outputSchema: z.object({ items: z.array(z.unknown()), count: z.number().int().nonnegative() }).strict(),
      async run(_ctx, rawInput) {
        const input = z.object({
          items: z.array(z.unknown()).max(5000),
          key: z.string().trim().min(1).max(200).optional(),
          direction: z.enum(["asc", "desc"]).default("asc"),
        }).strict().parse(rawInput);
        const sign = input.direction === "asc" ? 1 : -1;
        const items = input.items.map((item, index) => ({ item, index, value: input.key ? readPath(item, input.key) : item }))
          .sort((a, b) => {
            const left = a.value;
            const right = b.value;
            let order = 0;
            if (left === right) order = 0;
            else if (left === undefined || left === null) order = -1;
            else if (right === undefined || right === null) order = 1;
            else if (typeof left === "number" && typeof right === "number") order = left < right ? -1 : 1;
            else if (typeof left === "string" && typeof right === "string") order = left.localeCompare(right);
            else if (typeof left === "boolean" && typeof right === "boolean") order = left === right ? 0 : left ? 1 : -1;
            else order = (JSON.stringify(left) ?? String(left)).localeCompare(JSON.stringify(right) ?? String(right));
            return order === 0 ? a.index - b.index : order * sign;
          }).map(({ item }) => item);
        return { items, count: items.length };
      },
    },
    {
      id: "split_batches", name: "Split into batches",
      description: "Splits a bounded list into ordered batches for downstream processing. Batch size is explicitly bounded and no records are dropped.",
      inputSchema: z.object({
        items: z.array(z.unknown()).max(5000),
        batchSize: z.number().int().min(1).max(500),
      }).strict(),
      outputSchema: z.object({
        batches: z.array(z.array(z.unknown())),
        count: z.number().int().nonnegative(),
        batchCount: z.number().int().nonnegative(),
      }).strict(),
      async run(_ctx, rawInput) {
        const input = z.object({ items: z.array(z.unknown()).max(5000), batchSize: z.number().int().min(1).max(500) }).strict().parse(rawInput);
        const batches: unknown[][] = [];
        for (let offset = 0; offset < input.items.length; offset += input.batchSize) {
          batches.push(input.items.slice(offset, offset + input.batchSize));
        }
        return { batches, count: input.items.length, batchCount: batches.length };
      },
    },
    {
      id: "merge_objects", name: "Merge objects",
      description: "Merges two plain objects into a new object. The selected conflict policy determines which value wins when both objects contain the same top-level key.",
      inputSchema: z.object({
        left: z.record(z.string(), z.unknown()),
        right: z.record(z.string(), z.unknown()),
        conflict: z.enum(["right_wins", "left_wins", "error"]).default("right_wins"),
      }).strict(),
      outputSchema: z.object({ data: z.record(z.string(), z.unknown()) }).strict(),
      async run(_ctx, rawInput) {
        const input = z.object({
          left: z.record(z.string(), z.unknown()),
          right: z.record(z.string(), z.unknown()),
          conflict: z.enum(["right_wins", "left_wins", "error"]).default("right_wins"),
        }).strict().parse(rawInput);
        const data: Record<string, unknown> = { ...input.left };
        for (const [key, value] of Object.entries(input.right)) {
          if (Object.prototype.hasOwnProperty.call(data, key)) {
            if (input.conflict === "error") throw new Error("DATA_MERGE_KEY_CONFLICT");
            if (input.conflict === "left_wins") continue;
          }
          data[key] = value;
        }
        return { data };
      },
    },
    {
      id: "aggregate_numbers", name: "Aggregate numbers",
      description: "Calculates count, sum, average, minimum and maximum for a bounded list of finite numbers, rejecting non-numeric values rather than silently coercing them.",
      inputSchema: z.object({ values: z.array(z.number().finite()).max(10000).min(1) }).strict(),
      outputSchema: z.object({
        count: z.number().int().positive(), sum: z.number().finite(), average: z.number().finite(),
        min: z.number().finite(), max: z.number().finite(),
      }).strict(),
      async run(_ctx, rawInput) {
        const input = z.object({ values: z.array(z.number().finite()).max(10000).min(1) }).strict().parse(rawInput);
        const sum = input.values.reduce((total, value) => total + value, 0);
        if (!Number.isFinite(sum)) throw new Error("DATA_AGGREGATE_OVERFLOW");
        return { count: input.values.length, sum, average: sum / input.values.length, min: Math.min(...input.values), max: Math.max(...input.values) };
      },
    },
  ],
};
