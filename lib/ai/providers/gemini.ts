import { AIProviderError, classifyProviderError, normalizeProviderError } from "../errors";
import { parseStructuredJson } from "../validation/workflow-schema";
import { normalizeAIUsage, EMPTY_AI_USAGE } from "../usage";
import type {
  AIProvider, AIRequestContext, AIResult, AITextRequest,
  AIStructuredRequest, AIToolRequest, AIToolOutput, AIToolCall,
  AIProviderAttempt,
} from "../types";

type GeminiEnv = Record<string, string | undefined>;
type FetchLike = typeof fetch;

function reportAttempt(context: AIRequestContext, attempt: AIProviderAttempt): void {
  try { context.onProviderAttempt?.(attempt); } catch {
    // Diagnostics are deliberately best-effort and must never affect generation.
  }
}

export function createGeminiProvider(options: {
  env?: GeminiEnv;
  fetchImpl?: FetchLike;
} = {}): AIProvider {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;

  const baseUrl = (): string => {
    const raw = (env.GEMINI_API_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai").replace(/\/+$/, "");
    let parsed: URL;
    try { parsed = new URL(raw); } catch {
      throw new AIProviderError({ provider: "gemini", code: "AI_INVALID_REQUEST", message: "Gemini endpoint configuration is invalid." });
    }
    if (parsed.protocol !== "https:" && !(env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(parsed.hostname))) {
      throw new AIProviderError({ provider: "gemini", code: "AI_INVALID_REQUEST", message: "Gemini endpoint must use HTTPS." });
    }
    return raw;
  };

  async function request(
    body: Record<string, unknown>,
    context: AIRequestContext,
    requestedModel?: string,
  ): Promise<{ payload: Record<string, unknown>; model: string; requestId?: string; status: number; durationMs: number; usage: ReturnType<typeof normalizeAIUsage> }> {
    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) throw new AIProviderError({ provider: "gemini", code: "AI_NOT_CONFIGURED", message: "Gemini is not configured." });
    if (context.signal?.aborted) throw new AIProviderError({ provider: "gemini", code: "AI_CANCELLED", message: "AI request was cancelled." });

    const model = requestedModel || env.GEMINI_AI_MODEL || "gemini-3.8-flash";
    if (!/^[a-zA-Z0-9._:/-]{1,100}$/.test(model)) {
      throw new AIProviderError({ provider: "gemini", code: "AI_INVALID_REQUEST", message: "Gemini model configuration is invalid." });
    }

    const deadlineAt = context.deadlineAt ?? context.attemptBudget?.deadlineAt;
    const deadlineRemaining = deadlineAt === undefined ? Number.POSITIVE_INFINITY : deadlineAt - Date.now();
    if (deadlineRemaining <= 0) {
      throw new AIProviderError({ provider: "gemini", code: "AI_DEADLINE_EXCEEDED", message: "AI operation deadline was reached." });
    }
    const timeoutMs = Math.max(1, Math.min(context.timeoutMs ?? 16_000, deadlineRemaining));
    const controller = new AbortController();
    const startedAt = Date.now();
    const attempt = context.providerAttempt ?? 1;
    const fallbackUsed = context.fallbackUsed === true;
    let timedOut = false;
    let attemptReported = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    const onAbort = () => controller.abort(context.signal?.reason);
    context.signal?.addEventListener("abort", onAbort, { once: true });

    try {
      const response = await fetchImpl(baseUrl() + "/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + apiKey,
          "X-Rexnora-Operation-Id": context.operationId,
        },
        signal: controller.signal,
        body: JSON.stringify({ model, ...body }),
        cache: "no-store",
      });
      const requestId = response.headers.get("x-goog-request-id") || response.headers.get("x-request-id") || undefined;
      if (!response.ok) {
        let payload: unknown;
        try { payload = await response.json(); } catch { payload = undefined; }
        const error = classifyProviderError({
          provider: "gemini", status: response.status, headers: response.headers,
          payload, providerRequestId: requestId, providerModel: model,
        });
        reportAttempt(context, {
          model, attempt, status: response.status, retryAfterMs: error.retryAfterMs,
          errorCode: error.code, providerReason: error.providerReason,
          providerType: error.providerType, providerRequestId: error.providerRequestId,
          fallbackUsed,
        });
        attemptReported = true;
        throw error;
      }

      let payload: unknown;
      try { payload = await response.json(); } catch (cause) {
        throw new AIProviderError({ provider: "gemini", code: "AI_INVALID_RESPONSE", status: response.status, providerModel: model, message: "Gemini returned an unreadable response.", cause });
      }
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new AIProviderError({ provider: "gemini", code: "AI_INVALID_RESPONSE", status: response.status, providerModel: model, message: "Gemini returned an invalid response envelope." });
      }
      const record = payload as Record<string, unknown>;
      return {
        payload: record,
        model,
        requestId,
        status: response.status,
        durationMs: Math.max(0, Date.now() - startedAt),
        usage: normalizeAIUsage(record.usage),
      };
    } catch (caught) {
      const error = normalizeProviderError(caught, "gemini", context.signal);
      if (!attemptReported && error.code !== "AI_CANCELLED") {
        reportAttempt(context, {
          model,
          attempt,
          status: error.providerStatus ?? error.status ?? (error.code === "AI_TIMEOUT" ? 504 : 502),
          errorCode: error.code,
          retryAfterMs: error.retryAfterMs,
          providerRequestId: error.providerRequestId,
          fallbackUsed,
        });
      }
      if (context.signal?.aborted) {
        throw new AIProviderError({ provider: "gemini", code: "AI_CANCELLED", message: "AI request was cancelled.", cause: caught });
      }
      if (timedOut) {
        throw new AIProviderError({ provider: "gemini", code: "AI_TIMEOUT", status: 504, providerModel: model, message: "Gemini request timed out.", retryable: true, cause: caught });
      }
      throw error;
    } finally {
      clearTimeout(timer);
      context.signal?.removeEventListener("abort", onAbort);
    }
  }

  function messages(request: AITextRequest, systemPrompt = request.systemPrompt): Array<Record<string, string>> {
    return [
      ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
      { role: "user", content: request.prompt },
    ];
  }

  function reportOutputResult(
    context: AIRequestContext,
    result: { model: string; requestId?: string; status: number },
    error?: unknown,
  ): void {
    const code = error instanceof AIProviderError ? error.code : undefined;
    reportAttempt(context, {
      model: result.model,
      attempt: context.providerAttempt ?? 1,
      status: result.status,
      providerRequestId: result.requestId,
      ...(code ? { errorCode: code } : {}),
      fallbackUsed: context.fallbackUsed === true,
    });
  }

  function contentFrom(payload: Record<string, unknown>): { text: string; finishReason?: string; toolCalls: AIToolCall[] } {
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    const first = choices[0] && typeof choices[0] === "object" ? choices[0] as Record<string, unknown> : {};
    const message = first.message && typeof first.message === "object" ? first.message as Record<string, unknown> : {};
    const finishReason = typeof first.finish_reason === "string" ? first.finish_reason : undefined;
    if (finishReason === "content_filter" || finishReason === "safety") {
      throw new AIProviderError({ provider: "gemini", code: "AI_SAFETY_REJECTED", message: "Gemini declined the request for safety reasons." });
    }
    const text = typeof message.content === "string" ? message.content : "";
    const rawCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    const toolCalls = rawCalls.flatMap((raw, index) => {
      if (!raw || typeof raw !== "object") return [];
      const call = raw as Record<string, unknown>;
      const fn = call.function && typeof call.function === "object" ? call.function as Record<string, unknown> : {};
      if (typeof fn.name !== "string") return [];
      let args: unknown = fn.arguments;
      if (typeof args === "string") {
        try { args = JSON.parse(args); } catch (cause) {
          throw new AIProviderError({ provider: "gemini", code: "AI_INVALID_OUTPUT", message: "Gemini returned invalid tool arguments.", cause });
        }
      }
      if (!args || typeof args !== "object" || Array.isArray(args)) {
        throw new AIProviderError({ provider: "gemini", code: "AI_INVALID_OUTPUT", message: "Gemini tool arguments must be an object." });
      }
      return [{ id: typeof call.id === "string" ? call.id : "gemini_tool_" + index, name: fn.name, arguments: args as Record<string, unknown> }];
    });
    if (!text.trim() && !toolCalls.length) {
      throw new AIProviderError({ provider: "gemini", code: "AI_EMPTY_RESPONSE", message: "Gemini returned no content." });
    }
    return { text, finishReason, toolCalls };
  }

  const provider: AIProvider = {
    id: "gemini",
    capabilities: { text: true, structuredOutput: true, toolCalling: true },
    isConfigured: () => Boolean(env.GEMINI_API_KEY),

    async generateText(input: AITextRequest, context: AIRequestContext): Promise<AIResult<string>> {
      const result = await request({
        temperature: input.temperature ?? 0.2,
        max_tokens: input.maxOutputTokens ?? 1600,
        messages: messages(input),
      }, context, input.model);
      try {
        const content = contentFrom(result.payload);
        reportOutputResult(context, result);
        return {
          output: content.text,
          provider: "gemini",
          model: result.model,
          requestId: result.requestId,
          durationMs: result.durationMs,
          usage: result.usage ?? EMPTY_AI_USAGE,
          fallbackUsed: context.fallbackUsed === true,
        };
      } catch (error) {
        reportOutputResult(context, result, error);
        throw error;
      }
    },

    async generateStructured<T = unknown>(input: AIStructuredRequest<T>, context: AIRequestContext): Promise<AIResult<T>> {
      const schemaHint = input.schema ? "\n\nReturn JSON conforming to this schema:\n" + JSON.stringify(input.schema) : "";
      const result = await request({
        temperature: input.temperature ?? 0.2,
        max_tokens: input.maxOutputTokens ?? 2200,
        response_format: { type: "json_object" },
        messages: messages({ ...input, systemPrompt: (input.systemPrompt ?? "") + schemaHint }),
      }, context, input.model);
      try {
        const content = contentFrom(result.payload);
        const output = parseStructuredJson<T>(content.text, "gemini", input.validate);
        reportOutputResult(context, result);
        return {
          output,
          provider: "gemini",
          model: result.model,
          requestId: result.requestId,
          durationMs: result.durationMs,
          usage: result.usage ?? EMPTY_AI_USAGE,
          fallbackUsed: context.fallbackUsed === true,
        };
      } catch (error) {
        reportOutputResult(context, result, error);
        throw error;
      }
    },

    async generateWithTools(input: AIToolRequest, context: AIRequestContext): Promise<AIResult<AIToolOutput>> {
      if (!input.tools.length) throw new AIProviderError({ provider: "gemini", code: "AI_INVALID_REQUEST", message: "At least one tool definition is required." });
      const result = await request({
        temperature: input.temperature ?? 0.2,
        max_tokens: input.maxOutputTokens ?? 1800,
        messages: messages(input),
        tools: input.tools.map((tool) => ({
          type: "function",
          function: { name: tool.name, description: tool.description, parameters: tool.parameters },
        })),
        tool_choice: input.toolChoice ?? "auto",
      }, context, input.model);
      try {
        const content = contentFrom(result.payload);
        reportOutputResult(context, result);
        return {
          output: { text: content.text, toolCalls: content.toolCalls, finishReason: content.finishReason },
          provider: "gemini",
          model: result.model,
          requestId: result.requestId,
          durationMs: result.durationMs,
          usage: result.usage ?? EMPTY_AI_USAGE,
          fallbackUsed: context.fallbackUsed === true,
        };
      } catch (error) {
        reportOutputResult(context, result, error);
        throw error;
      }
    },
  };

  return provider;
}
