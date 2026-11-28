import { AIProviderError, normalizeProviderError } from "./errors";
import { InMemoryCircuitBreakerStore, SupabaseCircuitBreakerStore } from "./circuit-breaker";
import type { CircuitAdmission, CircuitPolicy, ProviderCircuitBreakerStore } from "./circuit-breaker";
import { createDefaultAIProviderRegistry } from "./registry";
import type { AIProviderRegistry } from "./registry";
import { SupabaseAIModelQualityStore } from "./quality/store";
import { applyQualityAwareRouting } from "./quality/routing";
import { routeAIRequests } from "./router";
import { claimProviderAttempt, DEFAULT_AI_RETRY_POLICY, withProviderRetries } from "./retry";
import { EMPTY_AI_USAGE } from "./usage";
import type {
  AIRequestContext, AIResult, AITextRequest, AIStructuredRequest, AIToolRequest,
  AIToolOutput, AIProvider, AIProviderId,
} from "./types";

const MAX_TOTAL_PROVIDER_ATTEMPTS = 8;
const MAX_PROVIDER_ATTEMPTS_PER_OPERATION = 4;

function boundedInteger(
  env: Record<string, string | undefined>,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = Number(env[name]);
  return Number.isSafeInteger(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

function boundedRate(
  env: Record<string, string | undefined>,
  name: string,
  fallback: number,
): number {
  const value = Number(env[name]);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

function circuitPolicy(env: Record<string, string | undefined>): CircuitPolicy {
  return {
    failureThreshold: boundedInteger(env, "AI_CIRCUIT_FAILURE_THRESHOLD", 3, 1, 20),
    failureRateThreshold: boundedRate(env, "AI_CIRCUIT_FAILURE_RATE_THRESHOLD", 0.5),
    minimumRequests: boundedInteger(env, "AI_CIRCUIT_MINIMUM_REQUESTS", 5, 2, 100),
    windowSeconds: boundedInteger(env, "AI_CIRCUIT_WINDOW_SECONDS", 300, 30, 3600),
    baseCooldownMs: boundedInteger(env, "AI_CIRCUIT_BASE_COOLDOWN_MS", 30_000, 1_000, 300_000),
    maxCooldownMs: boundedInteger(env, "AI_CIRCUIT_MAX_COOLDOWN_MS", 300_000, 1_000, 600_000),
    authCooldownMs: boundedInteger(env, "AI_CIRCUIT_AUTH_COOLDOWN_MS", 300_000, 1_000, 600_000),
  };
}

function isCircuitFailure(error: AIProviderError): boolean {
  if ([
    "AI_PROVIDER_AUTH_ERROR",
    "AI_RATE_LIMITED",
    "AI_PROVIDER_OVERLOADED",
    "AI_TIMEOUT",
    "AI_PROVIDER_UNAVAILABLE",
    "AI_NETWORK_ERROR",
    "AI_INVALID_RESPONSE",
    "AI_EMPTY_RESPONSE",
    "AI_INVALID_JSON",
    "AI_INVALID_OUTPUT",
  ].includes(error.code)) return true;
  const status = Number(error.providerStatus ?? error.status);
  return [408, 429, 500, 502, 503, 504].includes(status);
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
    "AI_PROVIDER_COOLDOWN",
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
    "AI_PROVIDER_COOLDOWN", "AI_PROVIDER_CIRCUIT_UNAVAILABLE",
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

function circuitUnavailableError(provider: AIProviderId): AIProviderError {
  return new AIProviderError({
    provider,
    code: "AI_PROVIDER_CIRCUIT_UNAVAILABLE",
    status: 503,
    message: "Shared AI provider health storage is unavailable.",
  });
}

function cooldownError(provider: AIProviderId, retryAfterMs: number): AIProviderError {
  return new AIProviderError({
    provider,
    code: "AI_PROVIDER_COOLDOWN",
    status: 503,
    retryAfterMs: Math.max(1, retryAfterMs),
    message: "AI provider is temporarily excluded by its shared health circuit.",
  });
}

const defaultRegistry = createDefaultAIProviderRegistry();

export function createAIGateway(
  registry: AIProviderRegistry = defaultRegistry,
  env: Record<string, string | undefined> = process.env,
  suppliedCircuitStore?: ProviderCircuitBreakerStore,
  suppliedQualityStore?: import("./quality/types").AIModelQualityStore,
) {
  // Unit tests/local isolated runs use deterministic memory. Every deployed
  // server environment uses shared Supabase state, not a Vercel instance map.
  const circuitStore = suppliedCircuitStore ?? (
    env.NODE_ENV === "test"
      ? new InMemoryCircuitBreakerStore()
      : new SupabaseCircuitBreakerStore()
  );
  const policy = circuitPolicy(env);

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
    if (operationBudget.remainingProviderAttempts <= 0 ||
        (operationBudget.totalProviderAttempts ?? 0) >= operationBudget.maxProviderAttempts) {
      throw new AIProviderError({
        provider: "gemini",
        code: "AI_ATTEMPT_LIMIT_REACHED",
        message: "AI operation provider attempt limit was reached.",
      });
    }

    const providerAttemptCounts = operationBudget.providerAttempts ?? {};
    const excludedProviders = [
      ...(context.excludedProviders ?? []),
      ...registry.list()
        .filter((provider) =>
          (providerAttemptCounts[provider.id] ?? 0) >= operationBudget.maxAttemptsPerProvider!,
        )
        .map((provider) => provider.id),
    ];
    const baseRoutes = routeAIRequests(context.task, registry, env, [...new Set(excludedProviders)]);
    const qualityStore = suppliedQualityStore ?? (
      env.NODE_ENV === "test" ? undefined : new SupabaseAIModelQualityStore()
    );
    // Existing gateway tests exercise provider/circuit failover independently.
    // Production always applies persistent qualification before choosing alternatives.
    const routes = qualityStore
      ? await applyQualityAwareRouting(
        baseRoutes,
        context.task,
        qualityStore,
        env.AI_QUALITY_REQUIRE_PRIMARY_QUALIFICATION === "true",
        (env.AI_PRIMARY_PROVIDER || "gemini").trim().toLowerCase() as AIProviderId,
      )
      : baseRoutes;
    let lastError: AIProviderError | undefined;
    const configuredPrimaryProvider = (env.AI_PRIMARY_PROVIDER || "gemini").trim().toLowerCase();

    for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
      const route = routes[routeIndex];
      const provider = route.provider;
      const providerFallback = route.selectedFallbackModel === true || provider.id !== configuredPrimaryProvider;

      if (context.signal?.aborted) {
        throw new AIProviderError({ provider: provider.id, code: "AI_CANCELLED", message: "AI request was cancelled." });
      }
      const currentDeadline = context.deadlineAt ?? context.attemptBudget?.deadlineAt;
      if (currentDeadline !== undefined && currentDeadline <= Date.now()) {
        throw new AIProviderError({ provider: provider.id, code: "AI_DEADLINE_EXCEEDED", message: "AI operation deadline was reached." });
      }
      if (context.attemptBudget &&
          (context.attemptBudget.remainingProviderAttempts <= 0 ||
            (context.attemptBudget.maxProviderAttempts !== undefined &&
              (context.attemptBudget.totalProviderAttempts ?? 0) >= context.attemptBudget.maxProviderAttempts))) {
        throw new AIProviderError({ provider: provider.id, code: "AI_ATTEMPT_LIMIT_REACHED", message: "AI provider attempt limit was reached." });
      }

      let admission: CircuitAdmission;
      try {
        admission = await circuitStore.acquire(provider.id, policy);
      } catch {
        // Never bypass shared-health storage failure with an uncoordinated local request.
        throw circuitUnavailableError(provider.id);
      }
      if (!admission.allowed) {
        lastError = cooldownError(provider.id, admission.retryAfterMs);
        continue;
      }

      let circuitOpenedDuringOperation = false;
      const invokeWithCircuit = async (
        model: string,
        attemptContext: AIRequestContext,
      ): Promise<AIResult<T>> => {
        if (circuitOpenedDuringOperation) {
          throw cooldownError(provider.id, admission.retryAfterMs || policy.baseCooldownMs);
        }

        let result: AIResult<T>;
        try {
          result = await invoke(provider, model, attemptContext);
        } catch (caught) {
          const error = normalizeProviderError(caught, provider.id, context.signal);
          const countAsFailure = isCircuitFailure(error);
          let snapshot;
          try {
            snapshot = await circuitStore.record(provider.id, {
              success: !countAsFailure,
              statusCode: error.providerStatus ?? error.status ?? 200,
              retryAfterMs: error.retryAfterMs,
              probe: admission.probe,
              policy,
            });
          } catch {
            throw circuitUnavailableError(provider.id);
          }
          if (!countAsFailure) throw caught;
          // Preserve the gateway's one bounded 429 Retry-After retry for the
          // already-admitted operation. The persistent circuit still excludes
          // subsequent requests from other Vercel instances.
          if (error.code === "AI_RATE_LIMITED" || Number(error.providerStatus ?? error.status) === 429) {
            throw caught;
          }
          if (snapshot.state === "open") {
            circuitOpenedDuringOperation = true;
            const remaining = snapshot.openUntil === undefined
              ? admission.retryAfterMs || policy.baseCooldownMs
              : Math.max(1, snapshot.openUntil - Date.now());
            throw cooldownError(provider.id, remaining);
          }
          throw caught;
        }

        try {
          await circuitStore.record(provider.id, {
            success: true,
            probe: admission.probe,
            policy,
          });
        } catch {
          throw circuitUnavailableError(provider.id);
        }
        return result;
      };

      try {
        let result: AIResult<T>;
        try {
          if (admission.probe) {
            // A half-open lease permits one real health probe, no retry burst,
            // and no alternate model on the same provider.
            const probeAttempt = claimProviderAttempt(provider.id, context);
            result = await invokeWithCircuit(
              route.primaryModel,
              providerContext({ ...context, providerAttempt: probeAttempt }, provider.id, providerFallback),
            );
          } else {
            result = await withProviderRetries(
              provider.id,
              providerContext(context, provider.id, providerFallback),
              (attemptContext) => invokeWithCircuit(route.primaryModel, attemptContext),
            );
          }
        } catch (caught) {
          let error = normalizeProviderError(caught, provider.id, context.signal);
          if (!admission.probe && canUseSameProviderModelFallback(error)) {
            try {
              const fallbackAttempt = claimProviderAttempt(provider.id, context);
              const fallbackContext = providerContext({
                ...context,
                providerAttempt: fallbackAttempt,
              }, provider.id, true);
              result = await invokeWithCircuit(route.fallbackModels[0], fallbackContext);
              return {
                ...result,
                usage: result.usage ?? EMPTY_AI_USAGE,
                fallbackUsed: true,
              };
            } catch (fallbackError) {
              error = normalizeProviderError(fallbackError, provider.id, context.signal);
            }
          }

          if (!canFailOver(error)) throw error;
          lastError = error;
          if (context.signal?.aborted || (currentDeadline !== undefined && currentDeadline <= Date.now())) {
            throw new AIProviderError({
              provider: provider.id,
              code: context.signal?.aborted ? "AI_CANCELLED" : "AI_DEADLINE_EXCEEDED",
              message: "AI request stopped before another provider could be attempted.",
            });
          }
          continue;
        }

        return {
          ...result,
          usage: result.usage ?? EMPTY_AI_USAGE,
          fallbackUsed: providerFallback || result.fallbackUsed === true,
        };
      } catch (caught) {
        const error = normalizeProviderError(caught, provider.id, context.signal);
        if (!canFailOver(error)) throw error;
        lastError = error;
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
        healthState: env.NODE_ENV === "test" ? "test-memory" as const : "shared-persistent" as const,
        capabilities: provider.capabilities,
      }));
    },
  };
}

export const aiGateway = createAIGateway();
