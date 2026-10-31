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
  ],
};
