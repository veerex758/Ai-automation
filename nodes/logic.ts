import { z } from "zod";
import type { NodeDefinition } from "./types";
import { findOperation } from "./registry";

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


const nestedStepSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  nodeId: z.string().min(1).max(64),
  operationId: z.string().min(1).max(64),
  input: z.record(z.string(), z.unknown()),
}).strict();

function resolveBranchReferences(value: unknown, outputs: Readonly<Record<string, unknown>>): unknown {
  if (typeof value === "string") {
    const exact = value.match(/^\{\{([a-zA-Z0-9_-]{1,64})(?:\.([a-zA-Z0-9_.-]{1,200}))?\}\}$/);
    const lookup = (path: string): unknown => {
      const [stepId, ...parts] = path.split(".");
      let current: unknown = outputs[stepId];
      for (const part of parts) {
        if (!current || typeof current !== "object" || Array.isArray(current) ||
            !Object.prototype.hasOwnProperty.call(current, part)) return undefined;
        current = (current as Record<string, unknown>)[part];
      }
      return current;
    };
    if (exact) {
      const resolved = lookup(exact[1] + (exact[2] ? "." + exact[2] : ""));
      if (resolved === undefined) throw new Error("WORKFLOW_REFERENCE_NOT_FOUND");
      return resolved;
    }
    return value.replace(/\{\{([a-zA-Z0-9_-]{1,64}(?:\.[a-zA-Z0-9_-]{1,64})*)\}\}/g, (match, path: string) => {
      const resolved = lookup(path);
      if (resolved === undefined || resolved === null) return match;
      return typeof resolved === "string" ? resolved : JSON.stringify(resolved);
    });
  }
  if (Array.isArray(value)) return value.map((part) => resolveBranchReferences(part, outputs));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, part]) => [key, resolveBranchReferences(part, outputs)]));
  return value;
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
      id: "if_else", name: "If / Else",
      description: "Evaluates a condition and executes only the selected branch. Each branch is limited to 10 registered actions; nested If / Else and Loop nodes are rejected to keep execution bounded. Returns the selected branch and its validated step outputs.",
      inputSchema: z.object({
        left: z.unknown().optional(),
        operator: z.enum(["equals", "not_equals", "contains", "greater_than", "less_than", "is_empty", "is_not_empty"]),
        right: z.unknown().optional(),
        thenSteps: z.array(nestedStepSchema).max(10).default([]),
        elseSteps: z.array(nestedStepSchema).max(10).default([]),
      }).strict(),
      outputSchema: z.object({
        result: z.boolean(), branch: z.enum(["then", "else"]), outputs: z.record(z.string(), z.unknown()),
      }).strict(),
      async run(ctx, rawInput) {
        const input = z.object({
          left: z.unknown().optional(),
          operator: z.enum(["equals", "not_equals", "contains", "greater_than", "less_than", "is_empty", "is_not_empty"]),
          right: z.unknown().optional(),
          thenSteps: z.array(nestedStepSchema).max(10).default([]),
          elseSteps: z.array(nestedStepSchema).max(10).default([]),
        }).strict().parse(rawInput);
        const result = compare(input.left, input.operator, input.right);
        const selected = result ? input.thenSteps : input.elseSteps;
        const outputs: Record<string, unknown> = {};
        const seen = new Set<string>();
        for (const step of selected) {
          if (seen.has(step.id)) throw new Error("IF_ELSE_DUPLICATE_STEP_ID");
          seen.add(step.id);
          if (step.nodeId === "loop" || (step.nodeId === "logic" && step.operationId === "if_else")) {
            throw new Error("IF_ELSE_NESTING_NOT_SUPPORTED");
          }
          if (!["logic", "data", "utilities", "date_time"].includes(step.nodeId)) {
            throw new Error("IF_ELSE_OPERATION_NOT_ALLOWED");
          }
          const operation = findOperation(step.nodeId, step.operationId, "action");
          if (!operation) throw new Error("IF_ELSE_OPERATION_NOT_FOUND");
          const resolved = resolveBranchReferences(step.input, { ...ctx.previousOutputs, ...outputs });
          const validated = operation.inputSchema.parse(resolved);
          const output = await operation.run({ ...ctx, previousOutputs: { ...ctx.previousOutputs, ...outputs } }, validated);
          outputs[step.id] = operation.outputSchema.parse(output);
        }
        return { result, branch: result ? "then" as const : "else" as const, outputs };
      },
    },
    {
      id: "switch",
      name: "Switch / Route",
      description: "Routes a value to the first matching case using strict equality. Supports up to 50 ordered cases and an optional default route; returns a route decision without executing downstream actions.",
      inputSchema: z.object({
        value: z.unknown(),
        cases: z.array(z.object({
          value: z.unknown(),
          route: z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/),
        }).strict()).max(50),
        defaultRoute: z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/).optional(),
      }).strict(),
      outputSchema: z.object({
        route: z.string().min(1).max(64),
        matched: z.boolean(),
        matchedIndex: z.number().int().nonnegative().optional(),
      }).strict(),
      async run(_ctx, rawInput) {
        const input = z.object({
          value: z.unknown(),
          cases: z.array(z.object({
            value: z.unknown(),
            route: z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/),
          }).strict()).max(50),
          defaultRoute: z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/).optional(),
        }).strict().parse(rawInput);
        const routes = input.cases.map((item) => item.route);
        if (new Set(routes).size !== routes.length) throw new Error("LOGIC_SWITCH_DUPLICATE_ROUTE");
        if (input.defaultRoute && routes.includes(input.defaultRoute)) throw new Error("LOGIC_SWITCH_DEFAULT_ROUTE_CONFLICT");
        const matchedIndex = input.cases.findIndex((item) => Object.is(item.value, input.value));
        if (matchedIndex >= 0) return { route: input.cases[matchedIndex].route, matched: true, matchedIndex };
        if (!input.defaultRoute) throw new Error("LOGIC_SWITCH_NO_MATCH");
        return { route: input.defaultRoute, matched: false };
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
