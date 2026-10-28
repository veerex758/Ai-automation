import { z } from "zod";
import type { NodeDefinition } from "./types";

const inputSchema = z.object({
  prompt: z.string().trim().min(1).max(12000).describe("The exact task or question for the model to answer."),
  system: z.string().max(4000).optional().describe("Optional behavior and formatting instructions for this single generation."),
  model: z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/).default("gpt-4o-mini").describe("An OpenAI model ID available to the connected account."),
  maxOutputTokens: z.number().int().min(1).max(4000).default(800),
}).strict();

const outputSchema = z.object({
  text: z.string(),
  model: z.string(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
}).strict();

export const openaiNode: NodeDefinition = {
  id: "openai", name: "OpenAI", icon: "brain-circuit", category: "ai", version: 1,
  auth: { type: "apiKey", credentialKey: "apiKey" },
  triggers: [],
  actions: [{
    id: "generate_text",
    name: "Generate text",
    description: "Calls the OpenAI Responses API to generate text from a prompt. Use when a workflow needs drafting, summarization, extraction or classification in natural language. prompt is the user task; system optionally constrains tone or format; model must be enabled for the connected account. Returns the actual generated text and available token usage. This action makes an external API call and may incur provider charges.",
    inputSchema, outputSchema,
    async run(ctx, rawInput) {
      const input = inputSchema.parse(rawInput);
      const apiKey = ctx.credentials.openai?.apiKey;
      if (!apiKey) throw new Error("OPENAI_CONNECTION_REQUIRED");
      const response = await ctx.http.request({
        url: "https://api.openai.com/v1/responses",
        method: "POST",
        headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
        body: {
          model: input.model,
          instructions: input.system,
          input: input.prompt,
          max_output_tokens: input.maxOutputTokens,
        },
        timeoutMs: 20000,
        retries: 2,
      });
      if (response.status < 200 || response.status >= 300) {
        ctx.logger.error("OpenAI generation failed", { status: response.status });
        throw new Error(response.status === 429 ? "OPENAI_RATE_LIMITED" : "OPENAI_REQUEST_FAILED");
      }
      const body = response.body as { output_text?: unknown; model?: unknown; usage?: { input_tokens?: unknown; output_tokens?: unknown } };
      if (typeof body?.output_text !== "string" || !body.output_text.trim()) throw new Error("OPENAI_EMPTY_RESPONSE");
      return outputSchema.parse({
        text: body.output_text,
        model: typeof body.model === "string" ? body.model : input.model,
        inputTokens: typeof body.usage?.input_tokens === "number" ? body.usage.input_tokens : undefined,
        outputTokens: typeof body.usage?.output_tokens === "number" ? body.usage.output_tokens : undefined,
      });
    },
  }],
};
