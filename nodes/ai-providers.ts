import { z } from "zod";
import type { NodeDefinition, NodeContext } from "./types";

const str = (max = 10000) => z.string().min(1).max(max);
const node = (id: string, name: string, auth: NodeDefinition["auth"]): NodeDefinition => ({ id, name, icon: "brain", category: "ai", version: 1, auth, triggers: [], actions: [] });
  if (!value || value.length > 4096 || value.includes("\r") || value.includes("\n")) throw new Error(id.toUpperCase() + "_CONNECTION_REQUIRED");
  const value = ctx.credentials[id]?.apiKey;
  if (!value || value.length > 4096 || /[\\r\\n]/.test(value)) throw new Error(id.toUpperCase() + "_CONNECTION_REQUIRED");
  return value;
};
const errorCode = (id: string, status: number) => id.toUpperCase() + (status === 401 || status === 403 ? "_AUTH_FAILED" : status === 429 ? "_RATE_LIMITED" : status >= 500 ? "_PROVIDER_UNAVAILABLE" : "_REQUEST_FAILED");
const request = async (ctx: NodeContext, id: string, endpoint: string, body: unknown) => {
  const r = await ctx.http.request({ url: endpoint, method: "POST", headers: { Authorization: "Bearer " + credential(ctx, id), "Content-Type": "application/json" }, body, timeoutMs: 20000, retries: 0 });
  if (r.status < 200 || r.status >= 300) throw new Error(errorCode(id, r.status));
  if (!r.body || typeof r.body !== "object" || Array.isArray(r.body)) throw new Error(id.toUpperCase() + "_INVALID_RESPONSE");
  return r.body as Record<string, unknown>;
};
const textOutput = z.object({ text: z.string(), raw: z.json() }).strict();
const promptInput = z.object({ prompt: str(12000), model: z.string().max(100).optional() }).strict();

const cohere = node("cohere", "Cohere", { type: "apiKey", credentialKey: "apiKey" });
cohere.actions.push({ id: "generate", name: "Generate text", description: "Generate text using Cohere Chat API.", inputSchema: promptInput, outputSchema: textOutput, async run(ctx, i) {
  const b = await request(ctx, "cohere", "https://api.cohere.com/v2/chat", { model: i.model ?? "command-r", messages: [{ role: "user", content: i.prompt }] });
  const message = b.message as Record<string, unknown> | undefined;
  const content = message?.content;
  const text = Array.isArray(content) ? content.map((part) => (part as Record<string, unknown>)?.text).filter((v): v is string => typeof v === "string").join("") : "";
  if (!text) throw new Error("COHERE_INVALID_RESPONSE");
  return { text, raw: b };
} });

const together = node("together_ai", "Together AI", { type: "apiKey", credentialKey: "apiKey" });
together.actions.push({ id: "generate", name: "Generate text", description: "Generate text through Together AI chat completions.", inputSchema: promptInput, outputSchema: textOutput, async run(ctx, i) {
  const b = await request(ctx, "together_ai", "https://api.together.xyz/v1/chat/completions", { model: i.model ?? "meta-llama/Llama-3.3-70B-Instruct-Turbo", messages: [{ role: "user", content: i.prompt }] });
  const choices = b.choices as Array<Record<string, unknown>> | undefined;
  const message = choices?.[0]?.message as Record<string, unknown> | undefined;
  if (typeof message?.content !== "string") throw new Error("TOGETHER_AI_INVALID_RESPONSE");
  return { text: message.content, raw: b };
} });

const replicate = node("replicate", "Replicate", { type: "apiKey", credentialKey: "apiKey" });
replicate.actions.push({ id: "run", name: "Start prediction", description: "Creates a Replicate prediction. Poll predictionId with durable Wait; this action does not wait for completion.", inputSchema: z.object({ version: str(200), input: z.record(z.string(), z.json()) }).strict(), outputSchema: z.object({ predictionId: z.string(), status: z.string(), raw: z.json() }).strict(), async run(ctx, i) {
  const b = await request(ctx, "replicate", "https://api.replicate.com/v1/predictions", { version: i.version, input: i.input });
  if (typeof b.id !== "string" || typeof b.status !== "string") throw new Error("REPLICATE_INVALID_RESPONSE");
  return { predictionId: b.id, status: b.status, raw: b };
} });

replicate.actions.push({ id: "get_prediction", name: "Get prediction", description: "Fetches a Replicate prediction by ID; pair with a durable scheduler/wait loop until status is succeeded, failed, or canceled.", inputSchema: z.object({ predictionId: str(128) }).strict(), outputSchema: z.object({ predictionId: z.string(), status: z.string(), output: z.json().optional(), error: z.string().optional(), raw: z.json() }).strict(), async run(ctx, i) {
  const r = await ctx.http.request({ url: "https://api.replicate.com/v1/predictions/" + encodeURIComponent(i.predictionId), method: "GET", headers: { Authorization: "Bearer " + credential(ctx, "replicate") }, timeoutMs: 15000, retries: 0 });
  if (r.status < 200 || r.status >= 300) throw new Error(errorCode("replicate", r.status));
  const b = r.body as Record<string, unknown>;
  if (typeof b?.id !== "string" || typeof b.status !== "string") throw new Error("REPLICATE_INVALID_RESPONSE");
  return { predictionId: b.id, status: b.status, output: b.output, error: typeof b.error === "string" ? b.error : undefined, raw: r.body };
} });

const deepl = node("deepl", "DeepL", { type: "apiKey", credentialKey: "apiKey" });
deepl.actions.push({ id: "translate", name: "Translate text", description: "Translate text with DeepL API Free endpoint.", inputSchema: z.object({ text: str(30000), targetLang: z.string().regex(/^[A-Z]{2,5}$/), sourceLang: z.string().regex(/^[A-Z]{2,5}$/).optional() }).strict(), outputSchema: z.object({ text: z.string(), detectedSourceLanguage: z.string().optional(), raw: z.json() }).strict(), async run(ctx, i) {
  const r = await ctx.http.request({ url: "https://api-free.deepl.com/v2/translate", method: "POST", headers: { Authorization: "DeepL-Auth-Key " + credential(ctx, "deepl"), "Content-Type": "application/json" }, body: { text: [i.text], target_lang: i.targetLang, source_lang: i.sourceLang }, timeoutMs: 20000, retries: 0 });
  if (r.status < 200 || r.status >= 300) throw new Error(errorCode("deepl", r.status));
  const b = r.body as { translations?: Array<{ text?: string; detected_source_language?: string }> };
  const translation = b?.translations?.[0];
  if (!translation || typeof translation.text !== "string") throw new Error("DEEPL_INVALID_RESPONSE");
  return { text: translation.text, detectedSourceLanguage: translation.detected_source_language, raw: r.body };
} });

const assembly = node("assemblyai", "AssemblyAI", { type: "apiKey", credentialKey: "apiKey" });
assembly.actions.push({ id: "transcribe", name: "Start transcription", description: "Submits an AssemblyAI transcription job. Poll transcriptId using durable Wait; text is not available until completion.", inputSchema: z.object({ audioUrl: z.string().url(), languageCode: z.string().max(20).optional() }).strict(), outputSchema: z.object({ transcriptId: z.string(), status: z.string(), raw: z.json() }).strict(), async run(ctx, i) {
  const r = await ctx.http.request({ url: "https://api.assemblyai.com/v2/transcript", method: "POST", headers: { authorization: credential(ctx, "assemblyai"), "Content-Type": "application/json" }, body: { audio_url: i.audioUrl, language_code: i.languageCode }, timeoutMs: 20000, retries: 0 });
  if (r.status < 200 || r.status >= 300) throw new Error(errorCode("assemblyai", r.status));
  const b = r.body as { id?: string; status?: string };
  if (!b?.id || !b.status) throw new Error("ASSEMBLYAI_INVALID_RESPONSE");
  return { transcriptId: b.id, status: b.status, raw: r.body };
} });

const whisper = node("openai_whisper", "OpenAI Whisper", { type: "apiKey", credentialKey: "apiKey" });
whisper.actions.push({ id: "transcribe", name: "Transcribe audio", description: "Not enabled: current HTTP transport supports JSON only; audio transcription requires multipart upload and bounded file handling.", inputSchema: z.object({ audioUrl: z.string().url(), model: z.string().default("whisper-1") }).strict(), outputSchema: z.object({ text: z.string(), raw: z.json() }).strict(), async run() { throw new Error("WHISPER_MULTIPART_TRANSPORT_NOT_IMPLEMENTED"); } });

const weaviate = node("weaviate", "Weaviate", { type: "apiKey", credentialKey: "apiKey" });
weaviate.actions.push({ id: "query", name: "Vector search", description: "Disabled until outbound gateway validates DNS/IP, blocks redirects and pins an approved tenant instance host.", inputSchema: z.object({ endpoint: z.string().url(), query: str(5000) }).strict(), outputSchema: z.object({ text: z.string(), raw: z.json() }).strict(), async run() { throw new Error("WEAVIATE_ADAPTER_BLOCKED_UNTIL_SSRF_SAFE_EGRESS"); } });

export const aiProviderNodes = [cohere, together, replicate, deepl, assembly, whisper, weaviate];