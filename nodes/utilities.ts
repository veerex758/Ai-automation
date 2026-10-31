import { z } from "zod";
import type { NodeDefinition } from "./types";

const parseInput = z.object({ text: z.string().max(32768).describe("JSON text to parse, up to 32 KiB.") }).strict();
const parseOutput = z.object({ value: z.unknown() }).strict();
const stringifyInput = z.object({ value: z.unknown(), pretty: z.boolean().default(false) }).strict();
const stringifyOutput = z.object({ text: z.string() }).strict();
const pickInput = z.object({
  data: z.record(z.string(), z.unknown()),
  fields: z.array(z.string().trim().min(1).max(200)).min(1).max(100).describe("Top-level field names to retain."),
}).strict();
const pickOutput = z.object({ data: z.record(z.string(), z.unknown()), missing: z.array(z.string()) }).strict();

export const utilitiesNode: NodeDefinition = {
  id: "utilities", name: "Utilities", icon: "wrench", category: "data", version: 1,
  auth: { type: "none" }, triggers: [],
  actions: [
    {
      id: "parse_json", name: "Parse JSON",
      description: "Parses a JSON string of up to 32 KiB into a value. Invalid JSON fails with a stable error code; no code is evaluated and no external services are called.",
      inputSchema: parseInput, outputSchema: parseOutput,
      async run(_ctx, rawInput) {
        const input = parseInput.parse(rawInput);
        let value: unknown;
        try { value = JSON.parse(input.text); } catch { throw new Error("JSON_PARSE_FAILED"); }
        return parseOutput.parse({ value });
      },
    },
    {
      id: "stringify_json", name: "Stringify JSON",
      description: "Serializes a JSON-compatible value to text, optionally with indentation. Output is capped at 32 KiB and circular or unsupported values fail safely.",
      inputSchema: stringifyInput, outputSchema: stringifyOutput,
      async run(_ctx, rawInput) {
        const input = stringifyInput.parse(rawInput);
        let text: string;
        try {
          const serialized = JSON.stringify(input.value, null, input.pretty ? 2 : undefined);
          if (serialized === undefined) throw new Error("unsupported");
          text = serialized;
        } catch { throw new Error("JSON_STRINGIFY_FAILED"); }
        if (Buffer.byteLength(text, "utf8") > 32768) throw new Error("JSON_OUTPUT_TOO_LARGE");
        return stringifyOutput.parse({ text });
      },
    },
    {
      id: "pick_fields", name: "Pick fields",
      description: "Creates a new object containing only the requested top-level fields from an input object, and lists missing fields separately. Does not mutate input data or call external services.",
      inputSchema: pickInput, outputSchema: pickOutput,
      async run(_ctx, rawInput) {
        const input = pickInput.parse(rawInput);
        const data: Record<string, unknown> = {};
        const missing: string[] = [];
        for (const field of input.fields) {
          if (Object.prototype.hasOwnProperty.call(input.data, field)) data[field] = input.data[field];
          else missing.push(field);
        }
        return pickOutput.parse({ data, missing });
      },
    },
  ],
};
