import { AIProviderError, normalizeProviderError } from "./errors";
import { createDefaultAIProviderRegistry } from "./registry";
import type { AIProviderRegistry } from "./registry";
import { routeAIRequests } from "./router";
import { claimProviderAttempt, DEFAULT_AI_RETRY_POLICY, withProviderRetries } from "./retry";
import { EMPTY_AI_USAGE } from "./usage";
import type {
  AIRequestContext, AIResult, AITextRequest, AIStructuredRequest, AIToolRequest,
  AIToolOutput, AIProvider, AIProviderId,
} from "./types";

const MAX_TOTAL_PROVIDER_ATTEMPTS = 8;
const MAX_PROVIDER_ATTEMPTS_PER_OPERATION = 4;
const MAX_PROVIDER_CONFIGURATION_COOLDOWN_MS = 5 * 60_000;

type ProviderHealthEntry = { unhealthyUntil: number; reason: "AI_PROVIDER_AUTH_ERROR" };

/**
 * Process-local circuit hint. The workflow endpoint also uses the persistent
 * Supabase Gemini circuit; this map prevents repeated auth failures in warm
 * serverless instances and is deliberately not presented as durable storage.
 */
const providerHealth = new Map<AIProviderId, ProviderHealthEntry>();

function providerIsHealthy(provider: AIProviderId, now = Date.now()): boolean {
  const entry = providerHealth.get(provider);
  if (!entry) return true;
  if (entry.unhealthyUntil <= now) {
    providerHealth.delete(provider);
    return true;
  }
  return false;
}

function markProviderConfigurationUnhealthy(provider: AIProviderId): void {
  providerHealth.set(provider, {
    unhealthyUntil: Date.now() + MAX_PROVIDER_CONFIGURATION_COOLDOWN_MS,
    reason: "AI_PROVIDER_AUTH_ERROR",
  });
}

function clearProviderHealth(provider: AIProviderId): void {
  providerHealth.delete(provider);
}

function isDeadlineOrCancellation(error: AIProviderError): boolean {
  return ["AI_CANCELLED", "AI_DEADLINE_EXCEEDED"].includes(error.code);
}

/** These errors must not be routed around. In particular, safety refusals stay refusals. */
function canFailOver(error: AIProviderError): boolean {
  if (isDeadlineOrCancellation(error)) return false;
  if (["AI_INVALID_REQUEST", "AI_SAFETY_REJECTED", "AI_UNSAFE_WORKFLOW"].includes(error.code)) {
    return error.code === "AI_UNSAFE_WORKFLOW";
  }
  const status = Number(error.providerStatus ?? error.status);
  return [
    "AI_RATE_LIMITED",
    "AI_PROVIDER_OVERLOADED",
    "AI_TIMEOUT",
    "AI_PROVIDER_UNAVAILABLE",
    "AI_NETWORK_ERROR",
    "AI_PROVIDER_AUTH_ERROR",
    "AI_INVALID_RESPONSE",
    "AI_EMPTY_RESPONSE",
    "AI_INVALID_JSON",
    "AI_INVALID_OUTPUT",
    "AI_ATTEMPT_LIMIT_REACHED",
  ].includes(error.code) || [408, 429, 500, 502, 503, 504].includes(status);
}

/** Try another model at the same provider only for transient infrastructure failures. */
function canUseSameProviderModelFallback(error: AIProviderError): boolean {
  if (error.retryAfterMs !== undefined && error.retryAfterMs > DEFAULT_AI_RETRY_POLICY.maxInlineWaitMs) {
    return false;
  }
  if ([
    "AI_RATE_LIMITED", "AI_PROVIDER_AUTH_ERROR", "AI_PROVIDER_UNAVAILABLE", "AI_NETWORK_ERROR",
    "AI_INVALID_REQUEST", "AI_INVALID_RESPONSE", "AI_INVALID_JSON", "AI_INVALID_OUTPUT",
    "AI_SAFETY_REJECTED", "AI_UNSAFE_WORKFLOW", "AI_EMPTY_RESPONSE",
    "AI_CANCELLED", "AI_DEADLINE_EXCEEDED", "AI_ATTEMPT_LIMIT_REACHED",
  ].includes(error.code)) return false;
  const status = Number(error.providerStatus ?? error.status);
  return error.code === "AI_TIMEOUT" || [408, 500, 502, 503, 504].includes(status);
}

function providerContext(
  context: AIRequestContext,
  provider: AIProviderId,
  fallbackUsed: boolean,
): AIRequestContext {
  return {
    ...context,
    fallbackUsed,
    onProviderAttempt: (attempt) => {
      try {
        context.onProviderAttempt?.({
          ...attempt,
          provider,
          fallbackUsed: attempt.fallbackUsed || fallbackUsed,
        });
      } catch {
        // Diagnostics never affect execution or retry decisions.
      }
    },
  };
}

const defaultRegistry = createDefaultAIProviderRegistry();

export function createAIGateway(
  registry: AIProviderRegistry = defaultRegistry,
  env: Record<string, string | undefined> = process.env,
) {
  async function execute<T>(
    inputContext: AIRequestContext,
    invoke: (provider: AIProvider, model: string, attemptContext: AIRequestContext) => Promise<AIResult<T>>,
  ): Promise<AIResult<T> & { fallbackUsed: boolean }> {
    const deadlineAt = inputContext.deadlineAt ?? inputContext.attemptBudget?.deadlineAt ?? Date.now() + 30_000;
    const context = inputContext.attemptBudget
      ? inputContext
      : {
        ...inputContext,
        deadlineAt,
        attemptBudget: {
          remainingProviderAttempts: MAX_TOTAL_PROVIDER_ATTEMPTS,
          totalProviderAttempts: 0,
          deadlineAt,
        },
      };
    const operationBudget = context.attemptBudget!;
    operationBudget.maxProviderAttempts = Math.min(
      operationBudget.maxProviderAttempts ?? MAX_TOTAL_PROVIDER_ATTEMPTS,
      MAX_TOTAL_PROVIDER_ATTEMPTS,
    );
    operationBudget.maxAttemptsPerProvider = Math.min(
      operationBudget.maxAttemptsPerProvider ?? MAX_PROVIDER_ATTEMPTS_PER_OPERATION,
      MAX_PROVIDER_ATTEMPTS_PER_OPERATION,
    );
    const providerAttemptCounts = operationBudget.providerAttempts ?? {};
    const excludedProviders = [
      ...(context.excludedProviders ?? []),
      ...registry.list()
        .filter((provider) =>
          !providerIsHealthy(provider.id) ||
          (providerAttemptCounts[provider.id] ?? 0) >= operationBudget.maxAttemptsPerProvider!,
        )
        .map((provider) => provider.id),
    ];
    const routes = routeAIRequests(context.task, registry, env, [...new Set(excludedProviders)]);
    let lastError: AIProviderError | undefined;
    const configuredPrimaryProvider = (env.AI_PRIMARY_PROVIDER || "gemini").trim().toLowerCase();

    for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
      const route = routes[routeIndex];
      const provider = route.provider;
      const providerFallback = provider.id !== configuredPrimaryProvider;

      if (context.signal?.aborted) {
        throw new AIProviderError({ provider: provider.id, code: "AI_CANCELLED", message: "AI request was cancelled." });
      }
      const deadlineAt = context.deadlineAt ?? context.attemptBudget?.deadlineAt;
      if (deadlineAt !== undefined && deadlineAt <= Date.now()) {
        throw new AIProviderError({ provider: provider.id, code: "AI_DEADLINE_EXCEEDED", message: "AI operation deadline was reached." });
      }
      if (context.attemptBudget &&
          (context.attemptBudget.remainingProviderAttempts <= 0 ||
            (context.attemptBudget.maxProviderAttempts !== undefined &&
              (context.attemptBudget.totalProviderAttempts ?? 0) >= context.attemptBudget.maxProviderAttempts))) {
        throw new AIProviderError({ provider: provider.id, code: "AI_ATTEMPT_LIMIT_REACHED", message: "AI provider attempt limit was reached." });
      }

      try {
        let result: AIResult<T>;
        try {
          result = await withProviderRetries(
            provider.id,
            providerContext(context, provider.id, providerFallback),
            (attemptContext) => invoke(provider, route.primaryModel, attemptContext),
          );
        } catch (caught) {
          let error = normalizeProviderError(caught, provider.id, context.signal);

          if (error.code === "AI_PROVIDER_AUTH_ERROR") {
            markProviderConfigurationUnhealthy(provider.id);
          }

          const fallbackModel = canUseSameProviderModelFallback(error) ? route.fallbackModels[0] : undefined;
          if (fallbackModel) {
            try {
              const fallbackAttempt = claimProviderAttempt(provider.id, context);
              const fallbackContext = providerContext({
                ...context,
                providerAttempt: fallbackAttempt,
              }, provider.id, true);
              result = await invoke(provider, fallbackModel, fallbackContext);
              clearProviderHealth(provider.id);
              return {
                ...result,
                usage: result.usage ?? EMPTY_AI_USAGE,
                fallbackUsed: true,
              };
            } catch (fallbackError) {
              error = normalizeProviderError(fallbackError, provider.id, context.signal);
              if (error.code === "AI_PROVIDER_AUTH_ERROR") markProviderConfigurationUnhealthy(provider.id);
            }
          }

          if (!canFailOver(error)) throw error;
          lastError = error;
          if (error.code === "AI_PROVIDER_AUTH_ERROR") markProviderConfigurationUnhealthy(provider.id);
          if (context.signal?.aborted || (deadlineAt !== undefined && deadlineAt <= Date.now())) {
            throw new AIProviderError({
              provider: provider.id,
              code: context.signal?.aborted ? "AI_CANCELLED" : "AI_DEADLINE_EXCEEDED",
              message: "AI request stopped before another provider could be attempted.",
            });
          }
          continue;
        }

        clearProviderHealth(provider.id);
        return {
          ...result,
          usage: result.usage ?? EMPTY_AI_USAGE,
          fallbackUsed: providerFallback || result.fallbackUsed === true,
        };
      } catch (caught) {
        const error = normalizeProviderError(caught, provider.id, context.signal);
        if (!canFailOver(error)) throw error;
        lastError = error;
        if (error.code === "AI_PROVIDER_AUTH_ERROR") markProviderConfigurationUnhealthy(provider.id);
      }
    }

    throw lastError ?? new AIProviderError({
      provider: "gemini",
      code: "AI_PROVIDER_ERROR",
      message: "All eligible AI providers failed.",
    });
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
        healthy: providerIsHealthy(provider.id),
        capabilities: provider.capabilities,
      }));
    },
  };
}

export const aiGateway = createAIGateway();
