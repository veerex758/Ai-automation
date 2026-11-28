import { AIProviderError, normalizeProviderError } from "./errors";
import type { AIProviderId, AIRequestContext } from "./types";

export type RetryPolicy = {
  /** Maximum calls to one provider for one gateway request. */
  maxAttempts: number;
  /** 429 retries are separate and more conservative than transient 5xx retries. */
  maxRateLimitRetries: number;
  baseDelayMs: number;
  maxInlineWaitMs: number;
};

export const DEFAULT_AI_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  maxRateLimitRetries: 1,
  baseDelayMs: 500,
  maxInlineWaitMs: 6_000,
};

/** Full-jitter exponential backoff, never shorter than a provider Retry-After value. */
export function retryDelayMs(
  attempt: number,
  retryAfterMs: number | undefined,
  policy: RetryPolicy = DEFAULT_AI_RETRY_POLICY,
  random: () => number = Math.random,
): number {
  const ceiling = Math.min(
    policy.maxInlineWaitMs,
    policy.baseDelayMs * (2 ** Math.max(0, attempt - 1)),
  );
  const sample = Number(random());
  const value = Number.isFinite(sample) ? Math.max(0, Math.min(1, sample)) : 0.5;
  const jitter = Math.floor(ceiling * value);
  return Math.max(jitter, Math.max(0, retryAfterMs ?? 0));
}

function remainingDeadline(context: AIRequestContext): number {
  const deadlineAt = context.deadlineAt ?? context.attemptBudget?.deadlineAt;
  return deadlineAt === undefined ? Number.POSITIVE_INFINITY : deadlineAt - Date.now();
}

function attachAttemptCount(
  error: AIProviderError,
  context: AIRequestContext,
  localProviderAttempt: number,
): AIProviderError {
  error.providerAttempts = context.attemptBudget?.totalProviderAttempts ?? localProviderAttempt;
  return error;
}

async function sleepWithinBudget(ms: number, context: AIRequestContext, provider: AIProviderId): Promise<void> {
  const delay = Math.max(0, ms);
  if (remainingDeadline(context) <= delay + 25) {
    throw new AIProviderError({
      provider,
      code: "AI_DEADLINE_EXCEEDED",
      message: "AI operation deadline prevents another retry.",
    });
  }
  if (context.signal?.aborted) {
    throw new AIProviderError({ provider, code: "AI_CANCELLED", message: "AI request was cancelled." });
  }
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      context.signal?.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(finish, delay);
    const abort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      context.signal?.removeEventListener("abort", abort);
      reject(new AIProviderError({ provider, code: "AI_CANCELLED", message: "AI request was cancelled." }));
    };
    context.signal?.addEventListener("abort", abort, { once: true });
    if (context.signal?.aborted) abort();
  });
}

/** Claim one provider call against the operation-wide shared budget. */
export function claimProviderAttempt(
  provider: AIProviderId,
  context: AIRequestContext,
  localProviderAttempt = context.providerAttempt ?? 0,
): number {
  if (context.signal?.aborted) {
    throw new AIProviderError({ provider, code: "AI_CANCELLED", message: "AI request was cancelled." });
  }
  if (remainingDeadline(context) <= 0) {
    throw new AIProviderError({ provider, code: "AI_DEADLINE_EXCEEDED", message: "AI operation deadline was reached." });
  }
  if (!context.attemptBudget) return localProviderAttempt + 1;
  if (context.attemptBudget.remainingProviderAttempts <= 0) {
    throw new AIProviderError({ provider, code: "AI_ATTEMPT_LIMIT_REACHED", message: "AI provider attempt limit was reached." });
  }
  context.attemptBudget.remainingProviderAttempts -= 1;
  context.attemptBudget.totalProviderAttempts = (context.attemptBudget.totalProviderAttempts ?? 0) + 1;
  return context.attemptBudget.totalProviderAttempts;
}

export async function withProviderRetries<T>(
  provider: AIProviderId,
  context: AIRequestContext,
  operation: (attemptContext: AIRequestContext) => Promise<T>,
  policy: RetryPolicy = DEFAULT_AI_RETRY_POLICY,
  sleep: (ms: number, context: AIRequestContext) => Promise<void> =
    (ms, attemptContext) => sleepWithinBudget(ms, attemptContext, provider),
): Promise<T> {
  let rateLimitRetries = 0;
  let localProviderAttempt = context.providerAttempt ?? 0;
  let lastError: AIProviderError | undefined;

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    if (context.signal?.aborted) {
      throw new AIProviderError({ provider, code: "AI_CANCELLED", message: "AI request was cancelled." });
    }
    if (remainingDeadline(context) <= 0) {
      throw attachAttemptCount(
        new AIProviderError({ provider, code: "AI_DEADLINE_EXCEEDED", message: "AI operation deadline was reached." }),
        context,
        localProviderAttempt,
      );
    }

    const providerAttempt = claimProviderAttempt(provider, context, localProviderAttempt);
    localProviderAttempt = providerAttempt;
    context.providerAttempt = providerAttempt;
    const attemptContext: AIRequestContext = { ...context, providerAttempt, fallbackUsed: context.fallbackUsed === true };

    try {
      return await operation(attemptContext);
    } catch (caught) {
      const error = normalizeProviderError(caught, provider, context.signal);
      lastError = error;
      const status = Number(error.providerStatus ?? error.status);

      if (status === 429 || error.code === "AI_RATE_LIMITED") {
        const wait = error.retryAfterMs ?? 0;
        if (rateLimitRetries < policy.maxRateLimitRetries && wait <= policy.maxInlineWaitMs) {
          const delay = retryDelayMs(rateLimitRetries + 1, wait, policy);
          rateLimitRetries += 1;
          await sleep(delay, context);
          continue;
        }
        throw attachAttemptCount(error, context, localProviderAttempt);
      }

      const transientStatus = [408, 500, 502, 503, 504].includes(status);
      const transient = transientStatus || error.code === "AI_TIMEOUT";
      // Connection failures and auth errors should move to another provider rather
      // than repeat the same request against an unreachable or misconfigured host.
      if (!transient) {
        throw attachAttemptCount(error, context, localProviderAttempt);
      }
      if (error.retryAfterMs !== undefined && error.retryAfterMs > policy.maxInlineWaitMs) break;
      if (attempt < policy.maxAttempts) {
        await sleep(retryDelayMs(attempt, error.retryAfterMs, policy), context);
        continue;
      }
      break;
    }
  }

  throw lastError
    ? attachAttemptCount(lastError, context, localProviderAttempt)
    : new AIProviderError({
      provider,
      code: "AI_PROVIDER_ERROR",
      message: "AI provider attempts were exhausted.",
    });
}
