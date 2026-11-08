import { z } from "zod";
import type { NodeDefinition } from "./types";

const forbiddenKeys = new Set(["__proto__", "prototype", "constructor"]);
const pathSchema = z.array(z.string().min(1).max(100)).max(20);

function readPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const part of path) {
    if (forbiddenKeys.has(part) || !current || typeof current !== "object" || Array.isArray(current) ||
      !Object.prototype.hasOwnProperty.call(current, part)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function safeObject(value: Record<string, unknown>): Record<string, unknown> {
  const entries = Object.entries(value);
  if (entries.length > 500) throw new Error("SET_FIELDS_TOO_MANY_FIELDS");
  for (const [key] of entries) {
    if (forbiddenKeys.has(key) || key.length > 100) throw new Error("SET_FIELDS_INVALID_KEY");
  }
  return Object.fromEntries(entries);
}

export const setFieldsNode: NodeDefinition = {
  id: "set_fields", name: "Set Fields", icon: "list-checks", category: "data", version: 1,
  auth: { type: "none" }, triggers: [], actions: [{
    id: "merge_fields", name: "Set or overwrite fields",
    description: "Creates a new object by copying an input data object and applying the supplied fields. Existing keys are overwritten; the input object is not mutated. Dangerous prototype keys are rejected and each object is limited to 500 fields.",
    inputSchema: z.object({ data: z.record(z.string(), z.unknown()).default({}), fields: z.record(z.string(), z.unknown()) }).strict(),
    outputSchema: z.object({ data: z.record(z.string(), z.unknown()) }).strict(),
    async run(_ctx, raw) {
      const input = z.object({ data: z.record(z.string(), z.unknown()).default({}), fields: z.record(z.string(), z.unknown()) }).strict().parse(raw);
      return { data: { ...safeObject(input.data), ...safeObject(input.fields) } };
    },
  }],
};

function sanitizeJson(value: unknown, depth = 0): unknown {
  if (depth > 40) throw new Error("JSON_PARSE_MAX_DEPTH");
  if (Array.isArray(value)) {
    if (value.length > 1000) throw new Error("JSON_PARSE_ARRAY_TOO_LARGE");
    return value.map((item) => sanitizeJson(item, depth + 1));
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 1000) throw new Error("JSON_PARSE_OBJECT_TOO_LARGE");
    for (const [key] of entries) if (forbiddenKeys.has(key)) throw new Error("JSON_PARSE_UNSAFE_KEY");
    return Object.fromEntries(entries.map(([key, item]) => [key, sanitizeJson(item, depth + 1)]));
  }
  return value;
}

export const jsonParseNode: NodeDefinition = {
  id: "json_parse", name: "JSON Parse", icon: "braces", category: "data", version: 1,
  auth: { type: "none" }, triggers: [], actions: [{
    id: "parse", name: "Parse JSON",
    description: "Parses a bounded JSON string into structured data and can select a nested property path. Rejects dangerous prototype keys, excessive nesting, oversized arrays and objects, and missing paths.",
    inputSchema: z.object({ json: z.string().min(1).max(100000), path: pathSchema.optional() }).strict(),
    outputSchema: z.object({ value: z.unknown(), compactJson: z.string() }).strict(),
    async run(_ctx, raw) {
      const input = z.object({ json: z.string().min(1).max(100000), path: pathSchema.optional() }).strict().parse(raw);
      let value: unknown;
      try { value = sanitizeJson(JSON.parse(input.json)); } catch (error) {
        if (error instanceof Error && error.message.startsWith("JSON_PARSE_")) throw error;
        throw new Error("JSON_PARSE_INVALID_INPUT");
      }
      if (input.path?.length) {
        value = readPath(value, input.path);
        if (value === undefined) throw new Error("JSON_PARSE_PATH_NOT_FOUND");
      }
      return { value, compactJson: JSON.stringify(value) };
    },
  }],
};

const filterInput = z.object({
  items: z.array(z.unknown()).max(1000),
  path: pathSchema,
  operator: z.enum(["eq", "ne", "contains", "gt", "gte", "lt", "lte", "exists"]),
  value: z.unknown().optional(),
}).strict();

export const filterNode: NodeDefinition = {
  id: "filter", name: "Filter", icon: "filter", category: "data", version: 1,
  auth: { type: "none" }, triggers: [], actions: [{
    id: "filter_items", name: "Filter items",
    description: "Filters up to 1,000 input items by a safe nested property path. Supports equality, inequality, contains, numeric or string comparisons, and existence checks. Missing paths do not match except for the exists operator.",
    inputSchema: filterInput,
    outputSchema: z.object({ items: z.array(z.unknown()), count: z.number().int().nonnegative() }).strict(),
    async run(_ctx, raw) {
      const input = filterInput.parse(raw);
      const items = input.items.filter((item) => {
        const actual = readPath(item, input.path);
        switch (input.operator) {
          case "exists": return actual !== undefined;
          case "eq": return actual === input.value;
          case "ne": return actual !== undefined && actual !== input.value;
          case "contains": return typeof actual === "string" ? actual.includes(String(input.value ?? "")) :
            Array.isArray(actual) ? actual.includes(input.value) : false;
          case "gt": return (typeof actual === "number" && typeof input.value === "number" && actual > input.value) ||
            (typeof actual === "string" && typeof input.value === "string" && actual > input.value);
          case "gte": return (typeof actual === "number" && typeof input.value === "number" && actual >= input.value) ||
            (typeof actual === "string" && typeof input.value === "string" && actual >= input.value);
          case "lt": return (typeof actual === "number" && typeof input.value === "number" && actual < input.value) ||
            (typeof actual === "string" && typeof input.value === "string" && actual < input.value);
          case "lte": return (typeof actual === "number" && typeof input.value === "number" && actual <= input.value) ||
            (typeof actual === "string" && typeof input.value === "string" && actual <= input.value);
        }
      });
      return { items, count: items.length };
    },
  }],
};

export const aggregateNode: NodeDefinition = {
  id: "aggregate", name: "Aggregate", icon: "sigma", category: "data", version: 1,
  auth: { type: "none" }, triggers: [], actions: [{
    id: "calculate", name: "Aggregate values",
    description: "Calculates count, sum, average, minimum or maximum over up to 1,000 items. Numeric operations require every selected value to be a finite number; count can operate on the item list without a property path.",
    inputSchema: z.object({
      items: z.array(z.unknown()).max(1000),
      operation: z.enum(["count", "sum", "average", "min", "max"]),
      path: pathSchema.optional(),
    }).strict(),
    outputSchema: z.object({ value: z.number(), count: z.number().int().nonnegative() }).strict(),
    async run(_ctx, raw) {
      const input = z.object({
        items: z.array(z.unknown()).max(1000),
        operation: z.enum(["count", "sum", "average", "min", "max"]),
        path: pathSchema.optional(),
      }).strict().parse(raw);
      if (input.operation === "count") return { value: input.items.length, count: input.items.length };
      if (!input.path?.length) throw new Error("AGGREGATE_PATH_REQUIRED");
      const values = input.items.map((item) => readPath(item, input.path!));
      if (values.some((value) => typeof value !== "number" || !Number.isFinite(value))) throw new Error("AGGREGATE_NUMERIC_VALUES_REQUIRED");
      const numbers = values as number[];
      if (!numbers.length) return { value: 0, count: 0 };
      const sum = numbers.reduce((total, value) => total + value, 0);
      const value = input.operation === "sum" ? sum : input.operation === "average" ? sum / numbers.length :
        input.operation === "min" ? Math.min(...numbers) : Math.max(...numbers);
      return { value, count: numbers.length };
    },
  }],
};

export const dateTimeNode: NodeDefinition = {
  id: "date_time", name: "Date/Time", icon: "calendar-clock", category: "data", version: 1,
  auth: { type: "none" }, triggers: [], actions: [{
    id: "current_time", name: "Get current date and time",
    description: "Returns the current UTC ISO timestamp and a localized display value for a valid IANA timezone such as Africa/Lagos or UTC. No external provider or credential is used.",
    inputSchema: z.object({ timezone: z.string().min(1).max(100).default("UTC") }).strict(),
    outputSchema: z.object({ iso: z.string().datetime(), local: z.string(), timezone: z.string() }).strict(),
    async run(_ctx, raw) {
      const input = z.object({ timezone: z.string().min(1).max(100).default("UTC") }).strict().parse(raw);
      const now = new Date();
      try { new Intl.DateTimeFormat("en", { timeZone: input.timezone }).format(now); }
      catch { throw new Error("DATE_TIME_INVALID_TIMEZONE"); }
      return {
        iso: now.toISOString(),
        local: new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "medium", timeZone: input.timezone }).format(now),
        timezone: input.timezone,
      };
    },
  }],
};

export const dataNodes: NodeDefinition[] = [setFieldsNode, jsonParseNode, filterNode, aggregateNode, dateTimeNode];


// Core Data node from main, registered alongside the expanded data utilities.
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

function readDataPath(value: unknown, path: string): unknown {
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
          data[target] = readDataPath(input.data, source) ?? null;
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
        const text = input.template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, path: string) => stringify(readDataPath(input.data, path)));
        return templateOutput.parse({ text });
      },
    },
  ],
};
