import { z } from "zod";
import type { NodeDefinition } from "./types";

const conditionInput = z.object({
  left: z.unknown().optional().describe("Value on the left side of the condition."),
  operator: z.enum(["equals", "not_equals", "contains", "greater_than", "less_than", "is_empty", "is_not_empty"]),
  right: z.unknown().optional().describe("Value compared against left; not needed for empty checks."),
}).strict();
const conditionOutput = z.object({ result: z.boolean() }).strict();

const filterInput = z.object({
  items: z.array(z.unknown()).max(1000).describe("Array of records to filter."),
  field: z.string().trim().min(1).max(200).describe("Dot-separated field path to inspect on each record."),
  operator: z.enum(["equals", "not_equals", "contains", "greater_than", "less_than", "is_empty", "is_not_empty"]),
  value: z.unknown().optional().describe("Comparison value; not needed for empty checks."),
}).strict();
const filterOutput = z.object({ items: z.array(z.unknown()), count: z.number().int().nonnegative() }).strict();

function readPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[key];
  }, value);
}
function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
}
function compare(left: unknown, operator: z.infer<typeof conditionInput>["operator"], right: unknown): boolean {
  switch (operator) {
    case "equals": return Object.is(left, right);
    case "not_equals": return !Object.is(left, right);
    case "contains":
      if (typeof left === "string") return typeof right === "string" && left.includes(right);
      if (Array.isArray(left)) return left.some((item) => Object.is(item, right));
      return false;
    case "greater_than": return typeof left === "number" && typeof right === "number" && left > right;
    case "less_than": return typeof left === "number" && typeof right === "number" && left < right;
    case "is_empty": return isEmpty(left);
    case "is_not_empty": return !isEmpty(left);
  }
}

export const logicNode: NodeDefinition = {
  id: "logic", name: "Logic", icon: "git-branch", category: "data", version: 1,
  auth: { type: "none" }, triggers: [],
  actions: [
    {
      id: "condition", name: "Evaluate condition",
      description: "Evaluates two values with equals, not-equals, contains, numeric greater-than or less-than, or empty checks. Returns a boolean result for downstream branching; performs no external side effects.",
      inputSchema: conditionInput, outputSchema: conditionOutput,
      async run(_ctx, rawInput) {
        const input = conditionInput.parse(rawInput);
        return conditionOutput.parse({ result: compare(input.left, input.operator, input.right) });
      },
    },
    {
      id: "filter_items", name: "Filter items",
      description: "Filters an array of records using a dot-separated field path and a supported comparison. Returns only matching records and their count; does not mutate the input or call external services.",
      inputSchema: filterInput, outputSchema: filterOutput,
      async run(_ctx, rawInput) {
        const input = filterInput.parse(rawInput);
        const items = input.items.filter((item) => compare(readPath(item, input.field), input.operator, input.value));
        return filterOutput.parse({ items, count: items.length });
      },
    },
  ],
};
