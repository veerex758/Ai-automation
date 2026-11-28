import type { AIErrorCode, AIProviderId } from "./types";

export class AIProviderError extends Error {
  readonly code: AIErrorCode;
  readonly provider: AIProviderId;
  readonly status?: number;
  /** Compatibility fields used by the existing workflow diagnostics route. */
  readonly providerStatus?: number;
  readonly providerModel?: string;
  readonly retryAfterMs?: number;
  readonly providerRequestId?: string;
  readonly providerReason?: string;
  readonly providerType?: string;
  providerAttempts?: number;
  readonly retryable: boolean;
  readonly safeMessage?: string;

  constructor(args: {
    code: AIErrorCode;
    provider: AIProviderId;
    message?: string;
    status?: number;
    providerStatus?: number;
    providerModel?: string;
    retryAfterMs?: number;
    providerRequestId?: string;
    providerReason?: string;
    providerType?: string;
    providerAttempts?: number;
    retryable?: boolean;
    cause?: unknown;
  }) {
    // Keep Error.message equal to the stable code: existing API routes map it to
    // safe customer-facing copy and must never surface provider response text.
    super(args.code, args.cause === undefined ? undefined : { cause: args.cause });
    this.name = "AIProviderError";
    this.code = args.code;
    this.provider = args.provider;
    this.status = args.status ?? args.providerStatus;
    this.providerStatus = args.providerStatus ?? args.status;
    this.providerModel = args.providerModel;
    this.retryAfterMs = args.retryAfterMs;
    this.providerRequestId = safeCode(args.providerRequestId, /^[A-Za-z0-9._:-]{1,100}$/);
    this.providerReason = safeCode(args.providerReason, /^[A-Z0-9_.-]{1,80}$/i);
    this.providerType = safeCode(args.providerType, /^[A-Z0-9_.-]{1,80}$/i);
    this.providerAttempts = args.providerAttempts;
    this.retryable = args.retryable ?? false;
    this.safeMessage = args.message;
  }
}

function safeCode(value: string | null | undefined, pattern: RegExp): string | undefined {
  return value && pattern.test(value) ? value : undefined;
}

function retryAfterMs(headers?: Headers, payload?: unknown): number | undefined {
  const headerValue = headers?.get("retry-after");
  let headerDelay = 0;
  if (headerValue) {
    const seconds = Number(headerValue);
    headerDelay = Number.isFinite(seconds) && seconds >= 0
      ? seconds * 1000
      : Math.max(0, Date.parse(headerValue) - Date.now());
  }
  const error = payload && typeof payload === "object"
    ? (payload as Record<string, unknown>).error : undefined;
  const details = error && typeof error === "object" && Array.isArray((error as Record<string, unknown>).details)
    ? (error as Record<string, unknown>).details as Array<Record<string, unknown>> : [];
  const retryInfo = details.find((item) =>
    typeof item?.["@type"] === "string" && String(item["@type"]).includes("RetryInfo")
  );
  const retryDelay = retryInfo?.retryDelay;
  const bodyMatch = typeof retryDelay === "string" ? retryDelay.match(/^(\d+(?:\.\d+)?)s$/i) : null;
  const bodyDelay = bodyMatch ? Math.ceil(Number(bodyMatch[1]) * 1000) : 0;
  const value = Math.max(headerDelay, bodyDelay);
  return value > 0 ? Math.min(10 * 60 * 1000, Math.ceil(value)) : undefined;
}

export function classifyProviderError(args: {
  provider: AIProviderId;
  status?: number;
  headers?: Headers;
  payload?: unknown;
  providerRequestId?: string | null;
  providerModel?: string;
  cause?: unknown;
}): AIProviderError {
  const status = args.status;
  let code: AIErrorCode = "AI_PROVIDER_ERROR";
  let retryable = false;

  if (status === 400 || status === 404 || status === 413 || status === 422) code = "AI_INVALID_REQUEST";
  else if (status === 401 || status === 403) code = "AI_PROVIDER_AUTH_ERROR";
  else if (status === 408) { code = "AI_TIMEOUT"; retryable = true; }
  else if (status === 429) { code = "AI_RATE_LIMITED"; retryable = true; }
  else if (status === 503) { code = "AI_PROVIDER_OVERLOADED"; retryable = true; }
  else if ([500, 502, 504].includes(Number(status))) { code = "AI_PROVIDER_ERROR"; retryable = true; }

  const errorBody = args.payload && typeof args.payload === "object"
    ? (args.payload as Record<string, unknown>).error : undefined;
  const details = errorBody && typeof errorBody === "object"
    ? errorBody as Record<string, unknown> : {};
  const reason = [details.status, details.reason, details.code]
    .find((item) => typeof item === "string" && /^[A-Z0-9_.-]{1,80}$/i.test(item as string));
  const type = typeof details.type === "string" && /^[A-Z0-9_.-]{1,80}$/i.test(details.type)
    ? details.type : undefined;

  return new AIProviderError({
    provider: args.provider,
    code,
    status,
    providerModel: args.providerModel,
    retryAfterMs: retryAfterMs(args.headers, args.payload),
    providerRequestId: args.providerRequestId ?? args.headers?.get("x-request-id") ?? args.headers?.get("x-goog-request-id"),
    providerReason: typeof reason === "string" ? reason : undefined,
    providerType: type,
    retryable,
    cause: args.cause,
  });
}

export function normalizeProviderError(error: unknown, provider: AIProviderId, signal?: AbortSignal): AIProviderError {
  if (error instanceof AIProviderError) return error;
  if (signal?.aborted) {
    return new AIProviderError({ provider, code: "AI_CANCELLED", message: "AI request was cancelled.", cause: error });
  }
  if (error instanceof Error && error.name === "AbortError") {
    return new AIProviderError({ provider, code: "AI_TIMEOUT", status: 504, message: "AI provider request timed out.", retryable: true, cause: error });
  }
  if (error instanceof TypeError || (error instanceof Error && /fetch failed|network|socket|econn|enotfound/i.test(error.message))) {
    return new AIProviderError({ provider, code: "AI_PROVIDER_UNAVAILABLE", status: 502, message: "AI provider could not be reached.", retryable: true, cause: error });
  }
  return new AIProviderError({ provider, code: "AI_PROVIDER_ERROR", message: "AI provider request failed.", cause: error });
}
