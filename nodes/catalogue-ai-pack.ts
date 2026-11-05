/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import type { NodeContext, NodeDefinition } from "./types";

type ProviderId = "elevenlabs" | "stability_ai" | "hugging_face" | "pinecone";

function credential(ctx: NodeContext, provider: ProviderId, key = "apiKey"): string {
  const value = ctx.credentials[provider]?.[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(provider.toUpperCase() + "_CONNECTION_REQUIRED");
  return value.trim();
}

async function request(ctx: NodeContext, provider: ProviderId, args: {
  url: string; method?: "GET" | "POST"; headers?: Record<string, string>; body?: unknown;
}): Promise<{ status: number; body: unknown }> {
  const response = await ctx.http.request({
    url: args.url, method: args.method ?? "GET", headers: args.headers,
    ...(args.body === undefined ? {} : { body: args.body }), timeoutMs: 20000, retries: 0,
  });
  if (response.status < 200 || response.status >= 300) {
    ctx.logger.error("AI provider operation failed", { provider, status: response.status });
    throw new Error(response.status === 429 ? provider.toUpperCase() + "_RATE_LIMITED" : provider.toUpperCase() + "_REQUEST_FAILED");
  }
  return response;
}

function node<I extends z.ZodTypeAny, O extends z.ZodTypeAny>(args: {
  id: ProviderId; name: string; description: string; input: I; output: O;
  run(ctx: NodeContext, input: z.infer<I>): Promise<unknown>;
}): NodeDefinition {
  return {
    id: args.id, name: args.name, icon: "brain-circuit", category: "ai", version: 1,
    auth: { type: "apiKey", credentialKey: "apiKey" }, triggers: [],
    actions: [{
      id: "execute", name: args.name + " action", description: args.description,
      inputSchema: args.input, outputSchema: args.output,
      async run(ctx, raw) {
        const input = args.input.parse(raw);
        return args.output.parse(await args.run(ctx, input));
      },
    }],
  };
}

export const catalogueAiNodes: NodeDefinition[] = [
  node({
    id: "elevenlabs", name: "ElevenLabs",
    description: "Lists available ElevenLabs voices for the connected workspace account; returns stable voice IDs for downstream text-to-speech steps.",
    input: z.object({ search: z.string().trim().max(120).optional(), pageSize: z.number().int().min(1).max(100).default(30) }).strict(),
    output: z.object({ voices: z.array(z.object({ voiceId: z.string(), name: z.string(), category: z.string().optional() }).strict()).max(100) }).strict(),
    async run(ctx, input) {
      const key = credential(ctx, "elevenlabs");
      const url = new URL("https://api.elevenlabs.io/v1/voices");
      url.searchParams.set("page_size", String(input.pageSize ?? 30));
      if (input.search) url.searchParams.set("search", input.search);
      const response = await request(ctx, "elevenlabs", { url: url.toString(), headers: { "xi-api-key": key } });
      const body = response.body as Record<string, unknown>;
      if (!body || typeof body !== "object" || !Array.isArray(body.voices)) throw new Error("ELEVENLABS_INVALID_RESPONSE");
      const voices = body.voices.flatMap((voice: any) => typeof voice?.voice_id === "string" && typeof voice?.name === "string"
        ? [{ voiceId: voice.voice_id, name: voice.name, ...(typeof voice.category === "string" ? { category: voice.category } : {}) }] : []);
      return { voices: voices.slice(0, input.pageSize ?? 30) };
    },
  }),
  node({
    id: "stability_ai", name: "Stability AI",
    description: "Lists the models available from the Stability AI v1 engines endpoint using the workspace API key.",
    input: z.object({}).strict(),
    output: z.object({ models: z.array(z.object({ id: z.string(), name: z.string().optional(), type: z.string().optional() }).strict()).max(200) }).strict(),
    async run(ctx) {
      const key = credential(ctx, "stability_ai");
      const response = await request(ctx, "stability_ai", { url: "https://api.stability.ai/v1/engines/list", headers: { Authorization: "Bearer " + key, Accept: "application/json" } });
      if (!Array.isArray(response.body)) throw new Error("STABILITY_AI_INVALID_RESPONSE");
      const models = response.body.flatMap((model: any) => typeof model?.id === "string"
        ? [{ id: model.id, ...(typeof model.name === "string" ? { name: model.name } : {}), ...(typeof model.type === "string" ? { type: model.type } : {}) }] : []);
      return { models: models.slice(0, 200) };
    },
  }),
  node({
    id: "hugging_face", name: "Hugging Face",
    description: "Runs bounded text generation against a caller-selected Hugging Face Inference API model using the saved workspace token.",
    input: z.object({ model: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/).max(200), inputs: z.string().trim().min(1).max(12000), maxNewTokens: z.number().int().min(1).max(1024).default(256) }).strict(),
    output: z.object({ generatedText: z.string().max(50000) }).strict(),
    async run(ctx, input) {
      const key = credential(ctx, "hugging_face");
      const response = await request(ctx, "hugging_face", {
        url: "https://api-inference.huggingface.co/models/" + input.model.split("/").map(encodeURIComponent).join("/"),
        method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
        body: { inputs: input.inputs, parameters: { max_new_tokens: input.maxNewTokens ?? 256 }, options: { wait_for_model: true } },
      });
      const raw = response.body;
      const first = Array.isArray(raw) ? raw[0] : raw;
      const generatedText = first && typeof first === "object" ? (first as Record<string, unknown>).generated_text : undefined;
      if (typeof generatedText !== "string") throw new Error("HUGGING_FACE_INVALID_RESPONSE");
      return { generatedText: generatedText.slice(0, 50000) };
    },
  }),
  node({
    id: "pinecone", name: "Pinecone",
    description: "Queries a configured Pinecone index with a bounded vector and returns matching IDs, scores and metadata.",
    input: z.object({ vector: z.array(z.number().finite()).min(1).max(4096), topK: z.number().int().min(1).max(100).default(10), namespace: z.string().max(500).optional(), includeMetadata: z.boolean().default(true) }).strict(),
    output: z.object({ matches: z.array(z.object({ id: z.string(), score: z.number(), metadata: z.record(z.string(), z.unknown()).optional() }).strict()).max(100) }).strict(),
    async run(ctx, input) {
      const key = credential(ctx, "pinecone");
      const host = credential(ctx, "pinecone", "indexHost");
      let parsed: URL;
      try { parsed = new URL(host.startsWith("https://") ? host : "https://" + host); } catch { throw new Error("PINECONE_CONNECTION_INVALID"); }
      if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".pinecone.io") || parsed.username || parsed.password) throw new Error("PINECONE_CONNECTION_INVALID");
      const response = await request(ctx, "pinecone", {
        url: parsed.origin + "/query", method: "POST",
        headers: { "Api-Key": key, "Content-Type": "application/json" },
        body: { vector: input.vector, topK: input.topK ?? 10, ...(input.namespace ? { namespace: input.namespace } : {}), includeMetadata: input.includeMetadata ?? true },
      });
      const body = response.body as Record<string, unknown>;
      if (!body || typeof body !== "object" || !Array.isArray(body.matches)) throw new Error("PINECONE_INVALID_RESPONSE");
      const matches = body.matches.flatMap((match: any) => typeof match?.id === "string" && typeof match?.score === "number"
        ? [{ id: match.id, score: match.score, ...(match.metadata && typeof match.metadata === "object" && !Array.isArray(match.metadata) ? { metadata: match.metadata } : {}) }] : []);
      return { matches: matches.slice(0, input.topK ?? 10) };
    },
  }),
];
