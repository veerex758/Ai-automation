// CommonJS is intentional for this .cjs module.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { randomUUID } = require("node:crypto");

const SAFE_EVENT_FIELDS = new Set([
  "event",
  "requestId",
  "operationId",
  "route",
  "outcome",
  "statusCode",
  "durationMs",
  "errorCode",
  "claimed",
  "succeeded",
  "failed",
  "provider",
  "model",
  "fallbackUsed",
  "providerStatus",
  "providerReason",
  "providerType",
  "providerRequestId",
  "providerAttempt",
  "retryAfterMs",
  "providerInputTokens",
  "providerOutputTokens",
  "providerTotalTokens",
]);

const SAFE_EVENT_NAMES = new Set([
  "workflow_generation",
  "scheduler_tick",
  "scheduled_workflow",
  "activity_list",
  "activity_run_detail",
  "live_workflow_run",
]);
const SAFE_MODELS_BY_PROVIDER = {
  gemini: new Set(["gemini-3.8-flash", "gemini-3.5-flash-lite"]),
  groq: new Set(["openai/gpt-oss-120b", "openai/gpt-oss-20b"]),
};
const SAFE_PROVIDER_REASONS = new Set([
  "INVALID_ARGUMENT", "RESOURCE_EXHAUSTED", "UNAVAILABLE", "PERMISSION_DENIED",
  "UNAUTHENTICATED", "FAILED_PRECONDITION", "INTERNAL", "DEADLINE_EXCEEDED",
  "NOT_FOUND", "ALREADY_EXISTS", "OUT_OF_RANGE", "CANCELLED", "UNKNOWN", "DATA_LOSS", "ABORTED",
]);
const SAFE_PROVIDER_TYPES = new Set([
  "invalid_request", "authentication_error", "permission_error", "rate_limit_error",
  "overloaded_error", "api_error", "internal_error", "not_found_error",
]);
const SAFE_REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ROUTE = /^\/[A-Za-z0-9/_-]{1,120}$/;
const SAFE_ERROR_CODES = new Set([
  "AI_PROVIDER_ERROR",
  "AI_PROVIDER_UNAVAILABLE",
  "AI_INVALID_REQUEST",
  "AI_INVALID_OUTPUT",
  "AI_SAFETY_REJECTED",
  "AI_DEADLINE_EXCEEDED",
  "AI_CANCELLED",
  "AI_ATTEMPT_LIMIT_REACHED",
  "AI_NOT_CONFIGURED",
  "AI_CONFIGURATION_ERROR",
  "AI_TIMEOUT",
  "AI_PROVIDER_OVERLOADED",
  "AI_PROVIDER_AUTH_ERROR",
  "AI_RATE_LIMITED",
  "AI_PROVIDER_COOLDOWN",
  "AI_PROVIDER_CIRCUIT_UNAVAILABLE",
  "AI_INVALID_RESPONSE",
  "AI_EMPTY_RESPONSE",
  "AI_INVALID_JSON",
  "AI_UNSAFE_WORKFLOW",
  "SCHEDULER_UNAUTHORIZED",
  "SCHEDULER_AUTH_NOT_CONFIGURED",
  "SCHEDULER_DATABASE_NOT_CONFIGURED",
  "SCHEDULER_CLAIM_FAILED",
  "SCHEDULED_RUN_FAILED",
  "INVALID_WORKFLOW_DEFINITION",
  "SCHEDULED_RUN_PERSISTENCE_FAILED",
  "SCHEDULED_RUN_FINALIZATION_FAILED",
  "SCHEDULED_QUEUE_DISPATCH_FAILED",
  "CRON_CONFIGURATION_REQUIRED",
  "SCHEDULE_CONFIG_LOOKUP_FAILED",
  "SCHEDULE_CREATOR_NOT_FOUND",
  "ACTIVITY_LIST_FAILED",
  "ACTIVITY_RUN_DETAIL_FAILED",
  "LIVE_RUN_FAILED",
  "LIVE_RUN_PERSISTENCE_FAILED",
  "LIVE_RUN_RECOVERY_FAILED",
  "DURABLE_DISPATCH_REQUIRED",
]);

function getRequestId(candidate) {
  if (typeof candidate === "string" && SAFE_REQUEST_ID.test(candidate)) {
    return candidate;
  }
  return randomUUID();
}

function logOperationalEvent(fields, sink = console.info) {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    throw new TypeError("Operational log event must be an object.");
  }

  const event = typeof fields.event === "string" ? fields.event : "";
  if (!SAFE_EVENT_NAMES.has(event)) {
    throw new TypeError("Operational log event name is invalid.");
  }

  const record = {
    timestamp: new Date().toISOString(),
    service: "aivanta",
    event,
  };

  for (const key of SAFE_EVENT_FIELDS) {
    if (key === "event" || fields[key] === undefined) continue;
    const value = fields[key];

    if (key === "requestId" && typeof value === "string" && SAFE_REQUEST_ID.test(value)) {
      record.requestId = value;
    } else if (key === "operationId" && typeof value === "string" && SAFE_REQUEST_ID.test(value)) {
      record.operationId = value;
    } else if (key === "route" && typeof value === "string" && SAFE_ROUTE.test(value)) {
      record.route = value;
    } else if (key === "outcome" && ["success", "failure", "rejected"].includes(value)) {
      record.outcome = value;
    } else if (key === "errorCode" && typeof value === "string" && SAFE_ERROR_CODES.has(value)) {
      record.errorCode = value;
    } else if (key === "provider" && typeof value === "string" && Object.hasOwn(SAFE_MODELS_BY_PROVIDER, value)) {
      record.provider = value;
    } else if (key === "model" && typeof value === "string" && SAFE_MODELS_BY_PROVIDER[record.provider]?.has(value)) {
      record.model = value;
    } else if (key === "fallbackUsed" && typeof value === "boolean") {
      record.fallbackUsed = value;
    } else if (key === "providerStatus" && Number.isSafeInteger(value) && value >= 100 && value <= 599) {
      record.providerStatus = value;
    } else if (key === "providerReason" && typeof value === "string" && SAFE_PROVIDER_REASONS.has(value)) {
      record.providerReason = value;
    } else if (key === "providerType" && typeof value === "string" && SAFE_PROVIDER_TYPES.has(value)) {
      record.providerType = value;
    } else if (key === "providerRequestId" && typeof value === "string" && /^[A-Za-z0-9._:-]{1,100}$/.test(value)) {
      record.providerRequestId = value;
    } else if (["statusCode", "durationMs", "claimed", "succeeded", "failed", "providerAttempt", "retryAfterMs", "providerInputTokens", "providerOutputTokens", "providerTotalTokens"].includes(key)
      && Number.isSafeInteger(value) && value >= 0) {
      record[key] = value;
    }
  }

  sink(JSON.stringify(record));
}

module.exports = { getRequestId, logOperationalEvent };
