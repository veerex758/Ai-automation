import { AIProviderError, normalizeProviderError } from "./errors";
import { createDefaultAIProviderRegistry } from "./registry";
import type { AIProviderRegistry } from "./registry";
import { routeAIRequest } from "./router";
import { DEFAULT_AI_RETRY_POLICY, withProviderRetries } from "./retry";
import { EMPTY_AI_USAGE } from "./usage";
import type {
  AIRequestContext, AIResult, AITextRequest, AIStructuredRequest, AIToolRequest,
  AIToolOutput, AIProvider,
} from "./types";

function canUseGeminiModelFallback(error: AIProviderError): boolean {
  const status = error.providerStatus ?? error.status;
  if ([
    "AI_RATE_LIMITED", "AI_PROVIDER_UNAVAILABLE", "AI_PROVIDER_AUTH_ERROR",
    "AI_INVALID_REQUEST", "AI_INVALID_JSON", "AI_INVALID_OUTPUT",
    "AI_SAFETY_REJECTED", "AI_EMPTY_RESPONSE", "AI_CANCELLED",
    "AI_DEADLINE_EXCEEDED", "AI_ATTEMPT_LIMIT_REACHED",
  ].includes(error.code)) return false;
  if (error.retryAfterMs !== undefined && error.retryAfterMs > DEFAULT_AI_RETRY_POLICY.maxInlineWaitMs) return false;
  return error.code === "AI_TIMEOUT" || [408, 500, 502, 503, 504].includes(Number(status));
}

function claimFallbackAttempt(provider: AIProvider, context: AIRequestContext): AIRequestContext {
  if (context.signal?.aborted) {
    throw new AIProviderError({ provider: provider.id, code: "AI_CANCELLED" });
  }
  const deadlineAt = context.deadlineAt ?? context.attemptBudget?.deadlineAt;
  if (deadlineAt !== undefined && deadlineAt <= Date.now()) {
    throw new AIProviderError({ provider: provider.id, code: "AI_DEADLINE_EXCEEDED" });
  }
  if (context.attemptBudget) {
    if (context.attemptBudget.remainingProviderAttempts <= 0) {
      throw new AIProviderError({ provider: provider.id, code: "AI_ATTEMPT_LIMIT_REACHED" });
    }
    context.attemptBudget.remainingProviderAttempts -= 1;
    context.attemptBudget.totalProviderAttempts = (context.attemptBudget.totalProviderAttempts ?? 0) + 1;
    return {
      ...context,
      providerAttempt: context.attemptBudget.totalProviderAttempts,
      fallbackUsed: true,
    };
  }
  return { ...context, providerAttempt: (context.providerAttempt ?? 0) + 1, fallbackUsed: true };
}

async function providerCall<T>(
  provider: AIProvider,
  context: AIRequestContext,
  invoke: (model: string, attemptContext: AIRequestContext) => Promise<AIResult<T>>,
  primaryModel: string,
  fallbackModels: string[],
): Promise<AIResult<T> & { fallbackUsed: boolean }> {
  try {
    const result = await withProviderRetries(
      provider.id,
      context,
      (attemptContext) => invoke(primaryModel, attemptContext),
    );
    return { ...result, usage: result.usage ?? EMPTY_AI_USAGE, fallbackUsed: false };
  } catch (caught) {
    const error = normalizeProviderError(caught, provider.id, context.signal);
    const fallbackModel = canUseGeminiModelFallback(error) ? fallbackModels[0] : undefined;
    if (!fallbackModel) throw error;
    const fallbackContext = claimFallbackAttempt(provider, context);
    const result = await invoke(fallbackModel, fallbackContext);
    return { ...result, usage: result.usage ?? EMPTY_AI_USAGE, fallbackUsed: true };
  }
}

const defaultRegistry = createDefaultAIProviderRegistry();

export function createAIGateway(
  registry: AIProviderRegistry = defaultRegistry,
  env: Record<string, string | undefined> = process.env,
) {
  async function execute<T>(
    context: AIRequestContext,
    invoke: (provider: AIProvider, model: string, attemptContext: AIRequestContext) => Promise<AIResult<T>>,
  ): Promise<AIResult<T> & { fallbackUsed: boolean }> {
    const route = routeAIRequest(context.task, registry, env);
    if (context.signal?.aborted) throw new AIProviderError({ provider: route.provider.id, code: "AI_CANCELLED" });
    const deadlineAt = context.deadlineAt ?? context.attemptBudget?.deadlineAt;
    if (deadlineAt !== undefined && deadlineAt <= Date.now()) {
      throw new AIProviderError({ provider: route.provider.id, code: "AI_DEADLINE_EXCEEDED" });
    }
    return providerCall(
      route.provider,
      context,
      (model, attemptContext) => invoke(route.provider, model, attemptContext),
      route.primaryModel,
      route.fallbackModels,
    );
  }

  return {
    generateText(request: AITextRequest, context: AIRequestContext) {
      return execute(context, (provider, model, attemptContext) => provider.generateText({ ...request, model }, attemptContext));
    },
    generateStructured<T>(request: AIStructuredRequest<T>, context: AIRequestContext) {
      return execute(context, (provider, model, attemptContext) => provider.generateStructured({ ...request, model }, attemptContext));
    },
    generateWithTools(request: AIToolRequest, context: AIRequestContext) {
      return execute<AIToolOutput>(context, (provider, model, attemptContext) => provider.generateWithTools({ ...request, model }, attemptContext));
    },
    listProviders() {
      return registry.list().map((provider) => ({
        id: provider.id,
        configured: provider.isConfigured(),
        capabilities: provider.capabilities,
      }));
    },
  };
}

export const aiGateway = createAIGateway();
