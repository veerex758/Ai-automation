import { z } from "zod";
import type { NodeDefinition } from "./types";

const inputSchema = z.object({
  prompt: z.string().trim().min(1).max(12000).describe("The exact task or question for Gemini to answer."),
  system: z.string().max(4000).optional().describe("Optional behavior and formatting instructions for this generation."),
  model: z.string().regex(/^[a-zA-Z0-9._:-]{1,100}$/).default("gemini-2.5-flash").describe("A Gemini model ID enabled for the configured API key."),
  maxOutputTokens: z.number().int().min(1).max(4000).default(800),
}).strict();

const outputSchema = z.object({
  text: z.string(),
  model: z.string(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
}).strict();


const leadInputSchema = z.object({
  leadData: z.string().trim().min(1).max(12000),
}).strict();

const leadOutputSchema = z.object({
  fullName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  propertyType: z.enum(["apartment", "house", "land", "commercial", "other", "unknown"]),
  location: z.string().nullable(),
  budget: z.string().nullable(),
  timeframe: z.enum(["urgent", "within_30_days", "one_to_three_months", "over_three_months", "unknown"]),
  temperature: z.enum(["hot", "warm", "cold"]),
  reason: z.string().min(1).max(500),
  missingInformation: z.array(z.string().max(120)).max(12),
  suggestedReply: z.string().min(1).max(1200),
  summary: z.string().min(1).max(2000),
}).strict();

const leadJsonSchema = {
  type: "OBJECT",
  properties: {
    fullName: { type: ["STRING", "NULL"] }, email: { type: ["STRING", "NULL"] },
    phone: { type: ["STRING", "NULL"] },
    propertyType: { type: "STRING", enum: ["apartment", "house", "land", "commercial", "other", "unknown"] },
    location: { type: ["STRING", "NULL"] }, budget: { type: ["STRING", "NULL"] },
    timeframe: { type: "STRING", enum: ["urgent", "within_30_days", "one_to_three_months", "over_three_months", "unknown"] },
    temperature: { type: "STRING", enum: ["hot", "warm", "cold"] },
    reason: { type: "STRING" }, missingInformation: { type: "ARRAY", items: { type: "STRING" } },
    suggestedReply: { type: "STRING" }, summary: { type: "STRING" },
  },
  required: ["fullName", "email", "phone", "propertyType", "location", "budget", "timeframe", "temperature", "reason", "missingInformation", "suggestedReply", "summary"],
  propertyOrdering: ["fullName", "email", "phone", "propertyType", "location", "budget", "timeframe", "temperature", "reason", "missingInformation", "suggestedReply", "summary"],
};

async function qualifyLead(ctx: Parameters<NonNullable<NodeDefinition["actions"][number]["run"]>>[0], rawInput: unknown) {
  const input = leadInputSchema.parse(rawInput);
  const apiKey = ctx.credentials.gemini?.apiKey;
  if (!apiKey) throw new Error("GEMINI_CONNECTION_REQUIRED");
  const response = await ctx.http.request({
    url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: {
      systemInstruction: { parts: [{ text: "You qualify real-estate enquiries for an agency. Extract only facts present in the enquiry. Never invent a name, contact, budget, location, property type or timeframe. Use null for missing scalar facts and list them in missingInformation. Classify hot only when there is clear near-term intent and enough contact/context; warm for genuine interest without urgency; cold for vague or low-intent enquiries. Keep reason factual. Return only schema-conforming JSON." }] },
      contents: [{ role: "user", parts: [{ text: "Qualify this enquiry:\\n" + input.leadData }] }],
      generationConfig: { responseMimeType: "application/json", responseJsonSchema: leadJsonSchema, maxOutputTokens: 1200, temperature: 0.1 },
    },
    timeoutMs: 20000,
    retries: 1,
  });
  if (response.status < 200 || response.status >= 300) {
    ctx.logger.error("Gemini lead qualification failed", { status: response.status });
    throw new Error(response.status === 429 ? "GEMINI_RATE_LIMITED" : "GEMINI_REQUEST_FAILED");
  }
  const body = response.body as { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }> };
  const text = body?.candidates?.[0]?.content?.parts?.map((part) => typeof part.text === "string" ? part.text : "").join("") ?? "";
  if (!text.trim()) throw new Error("GEMINI_EMPTY_RESPONSE");
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error("GEMINI_INVALID_JSON"); }
  return leadOutputSchema.parse(parsed);
}
\nexport const geminiNode: NodeDefinition = {
  id: "gemini", name: "Gemini", icon: "brain-circuit", category: "ai", version: 1,
  auth: { type: "apiKey", credentialKey: "apiKey" },
  triggers: [],
  actions: [{
    id: "generate_text",
    name: "Generate text",
    description: "Calls the Google Gemini API to draft, summarize, extract or classify text. prompt is the task; system optionally constrains tone or format. Returns generated text and available token usage. This action makes an external API call and may incur provider charges.",
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
          ...(input.system ? { systemInstruction: { parts: [{ text: input.system }] } } : {}),
          contents: [{ role: "user", parts: [{ text: input.prompt }] }],
          generationConfig: { maxOutputTokens: input.maxOutputTokens },
        },
        timeoutMs: 20000,
        retries: 2,
      });
      if (response.status < 200 || response.status >= 300) {
        ctx.logger.error("Gemini generation failed", { status: response.status });
        throw new Error(response.status === 429 ? "GEMINI_RATE_LIMITED" : "GEMINI_REQUEST_FAILED");
      }
      const body = response.body as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>;
        modelVersion?: unknown;
        usageMetadata?: { promptTokenCount?: unknown; candidatesTokenCount?: unknown };
      };
      const text = body?.candidates?.[0]?.content?.parts
        ?.map((part) => typeof part.text === "string" ? part.text : "")
        .join("") ?? "";
      if (!text.trim()) throw new Error("GEMINI_EMPTY_RESPONSE");
      return outputSchema.parse({
        text,
        model: typeof body.modelVersion === "string" ? body.modelVersion : input.model,
        inputTokens: typeof body.usageMetadata?.promptTokenCount === "number" ? body.usageMetadata.promptTokenCount : undefined,
        outputTokens: typeof body.usageMetadata?.candidatesTokenCount === "number" ? body.usageMetadata.candidatesTokenCount : undefined,
      });
    },
  }],
};
