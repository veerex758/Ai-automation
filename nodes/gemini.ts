import { z } from "zod";
import type { NodeDefinition } from "./types";

const inputSchema = z.object({
  prompt: z.string().trim().min(1).max(12000).describe("The exact task for Gemini."),
  system: z.string().max(4000).optional().describe("Optional system instruction."),
  model: z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/).default("gemini-2.5-flash"),
  maxOutputTokens: z.number().int().min(1).max(4000).default(800),
}).strict();
const outputSchema = z.object({
  text: z.string(),
  model: z.string(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
}).strict();

export const geminiNode: NodeDefinition = {
  id: "gemini", name: "Google Gemini", icon: "sparkles", category: "ai", version: 1,
  auth: { type: "apiKey", credentialKey: "apiKey" },
  triggers: [],
  actions: [{
    id: "generate_text", name: "Generate text",
    description: "Generates real text using Google Gemini with a workspace-connected API key. External API call; provider quotas may apply.",
    inputSchema, outputSchema,
    async run(ctx, rawInput) {
      const input = inputSchema.parse(rawInput);
      const apiKey = ctx.credentials.gemini?.apiKey;
      if (!apiKey) throw new Error("GEMINI_CONNECTION_REQUIRED");
      const response = await ctx.http.request({
        url: "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(input.model) + ":generateContent",
        method: "POST",
        headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
        body: {
          systemInstruction: input.system ? { parts: [{ text: input.system }] } : undefined,
          contents: [{ role: "user", parts: [{ text: input.prompt }] }],
          generationConfig: { maxOutputTokens: input.maxOutputTokens },
        },
        timeoutMs: 20000,
      });
      if (response.status < 200 || response.status >= 300) {
        ctx.logger.error("Gemini generation failed", { status: response.status });
        throw new Error(response.status === 429 ? "GEMINI_RATE_LIMITED" : response.status === 401 || response.status === 403 ? "GEMINI_AUTH_FAILED" : "GEMINI_REQUEST_FAILED");
      }
      const body = response.body as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>;
        modelVersion?: unknown;
        usageMetadata?: { promptTokenCount?: unknown; candidatesTokenCount?: unknown };
      };
      const text = body?.candidates?.[0]?.content?.parts?.map((part) => typeof part.text === "string" ? part.text : "").join("").trim();
      if (!text) throw new Error("GEMINI_EMPTY_RESPONSE");
      return outputSchema.parse({
        text,
        model: typeof body.modelVersion === "string" ? body.modelVersion : input.model,
        inputTokens: typeof body.usageMetadata?.promptTokenCount === "number" ? body.usageMetadata.promptTokenCount : undefined,
        outputTokens: typeof body.usageMetadata?.candidatesTokenCount === "number" ? body.usageMetadata.candidatesTokenCount : undefined,
      });
    },
  }],
};
