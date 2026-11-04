import { z } from "zod";
import type { NodeDefinition } from "./types";

const comparison = z.enum(["equals", "not_equals", "greater_than", "greater_or_equal", "less_than", "less_or_equal", "contains", "exists", "is_empty"]);

function compare(actual: unknown, expected: unknown, operator: z.infer<typeof comparison>): boolean {
  switch (operator) {
    case "equals": return Object.is(actual, expected);
    case "not_equals": return !Object.is(actual, expected);
    case "greater_than": return typeof actual === "number" && typeof expected === "number" ? actual > expected : typeof actual === "string" && typeof expected === "string" ? actual > expected : false;
    case "greater_or_equal": return typeof actual === "number" && typeof expected === "number" ? actual >= expected : typeof actual === "string" && typeof expected === "string" ? actual >= expected : false;
    case "less_than": return typeof actual === "number" && typeof expected === "number" ? actual < expected : typeof actual === "string" && typeof expected === "string" ? actual < expected : false;
    case "less_or_equal": return typeof actual === "number" && typeof expected === "number" ? actual <= expected : typeof actual === "string" && typeof expected === "string" ? actual <= expected : false;
    case "contains": return typeof actual === "string" && typeof expected === "string" ? actual.includes(expected) : Array.isArray(actual) ? actual.some((item) => Object.is(item, expected)) : false;
    case "exists": return actual !== undefined && actual !== null;
    case "is_empty": return actual === undefined || actual === null || actual === "" || (Array.isArray(actual) && actual.length === 0) || (typeof actual === "object" && actual !== null && Object.keys(actual).length === 0);
  }
}

const ifInput = z.object({
  value: z.unknown(),
  operator: comparison,
  compareTo: z.unknown().optional(),
}).strict();

export const ifNode: NodeDefinition = {
  id: "if", name: "IF", icon: "git-branch", category: "data", version: 1,
  auth: { type: "none" }, triggers: [],
  actions: [{
    id: "evaluate", name: "Evaluate condition",
    description: "Evaluates a typed condition and returns a true or false route for downstream branch selection. Numeric and string comparisons are type-safe; contains supports strings and arrays.",
    inputSchema: ifInput,
    outputSchema: z.object({ matched: z.boolean(), route: z.enum(["true", "false"]) }).strict(),
    async run(_ctx, raw) {
      const input = ifInput.parse(raw);
      const matched = compare(input.value, input.compareTo, input.operator);
      return { matched, route: matched ? "true" as const : "false" as const };
    },
  }],
};

const switchInput = z.object({
  value: z.unknown(),
  cases: z.array(z.object({ value: z.unknown(), route: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/) }).strict()).min(1).max(20),
  defaultRoute: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/).default("default"),
}).strict();

export const switchNode: NodeDefinition = {
  id: "switch", name: "Switch", icon: "workflow", category: "data", version: 1,
  auth: { type: "none" }, triggers: [],
  actions: [{
    id: "select_route", name: "Select matching route",
    description: "Selects the first exact-match case and returns its route label, or the configured default route. Case count and route labels are bounded and validated.",
    inputSchema: switchInput,
    outputSchema: z.object({ route: z.string(), matchedCase: z.number().int().nonnegative().nullable() }).strict(),
    async run(_ctx, raw) {
      const input = switchInput.parse(raw);
      const index = input.cases.findIndex((item) => Object.is(item.value, input.value));
      return { route: index < 0 ? input.defaultRoute : input.cases[index].route, matchedCase: index < 0 ? null : index };
    },
  }],
};

const mergeInput = z.object({
  mode: z.enum(["append", "merge_objects", "merge_by_key"]),
  inputs: z.array(z.unknown()).min(1).max(100),
  key: z.string().min(1).max(100).optional(),
}).strict();

export const mergeNode: NodeDefinition = {
  id: "merge", name: "Merge", icon: "combine", category: "data", version: 1,
  auth: { type: "none" }, triggers: [],
  actions: [{
    id: "merge_inputs", name: "Merge inputs",
    description: "Combines up to 100 inputs by appending values, merging plain objects in input order, or merging arrays of objects by a selected key. Rejects prototype-sensitive keys and ambiguous key types.",
    inputSchema: mergeInput,
    outputSchema: z.object({ value: z.unknown(), count: z.number().int().nonnegative() }).strict(),
    async run(_ctx, raw) {
      const input = mergeInput.parse(raw);
      if (input.mode === "append") {
        const value = input.inputs.flatMap((item) => Array.isArray(item) ? item : [item]);
        if (value.length > 1000) throw new Error("MERGE_OUTPUT_TOO_LARGE");
        return { value, count: value.length };
      }
      if (input.mode === "merge_objects") {
        const output: Record<string, unknown> = Object.create(null);
        for (const item of input.inputs) {
          if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("MERGE_OBJECTS_REQUIRED");
          for (const [key, value] of Object.entries(item)) {
            if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error("MERGE_UNSAFE_KEY");
            output[key] = value;
          }
        }
        return { value: Object.fromEntries(Object.entries(output)), count: Object.keys(output).length };
      }
      if (!input.key) throw new Error("MERGE_KEY_REQUIRED");
      const merged = new Map<string | number, Record<string, unknown>>();
      for (const item of input.inputs) {
        if (!Array.isArray(item)) throw new Error("MERGE_ARRAYS_REQUIRED");
        for (const entry of item) {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("MERGE_OBJECTS_REQUIRED");
          const record = entry as Record<string, unknown>;
          const id = record[input.key];
          if ((typeof id !== "string" && typeof id !== "number") || !Number.isFinite(typeof id === "number" ? id : 0)) throw new Error("MERGE_KEY_VALUE_REQUIRED");
          const existing = merged.get(id) ?? Object.create(null) as Record<string, unknown>;
          for (const [field, value] of Object.entries(record)) {
            if (["__proto__", "prototype", "constructor"].includes(field)) throw new Error("MERGE_UNSAFE_KEY");
            existing[field] = value;
          }
          merged.set(id, existing);
        }
      }
      const value = Array.from(merged.values(), (record) => Object.fromEntries(Object.entries(record)));
      return { value, count: value.length };
    },
  }],
};
