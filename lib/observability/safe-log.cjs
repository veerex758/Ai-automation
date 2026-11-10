// CommonJS is intentional for this .cjs module.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { randomUUID } = require("node:crypto");

const SAFE_EVENT_FIELDS = new Set([
  "event",
  "requestId",
  "route",
  "outcome",
  "statusCode",
  "durationMs",
  "errorCode",
  "claimed",
  "succeeded",
  "failed",
]);

const SAFE_EVENT_NAMES = new Set([
  "workflow_generation",
  "scheduler_tick",
  "scheduled_workflow",
  "activity_list",
  "activity_run_detail",
  "live_workflow_run",
]);
const SAFE_REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ROUTE = /^\/[A-Za-z0-9/_-]{1,120}$/;
const SAFE_ERROR_CODES = new Set([
  "AI_PROVIDER_ERROR",
  "AI_NOT_CONFIGURED",
  "AI_CONFIGURATION_ERROR",
  "AI_TIMEOUT",
  "AI_PROVIDER_UNAVAILABLE",
  "AI_PROVIDER_AUTH_ERROR",
  "AI_RATE_LIMITED",
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
  "ACTIVITY_LIST_FAILED",
  "ACTIVITY_RUN_DETAIL_FAILED",
  "LIVE_RUN_FAILED",
  "LIVE_RUN_PERSISTENCE_FAILED",
  "LIVE_RUN_RECOVERY_FAILED",
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
    } else if (key === "route" && typeof value === "string" && SAFE_ROUTE.test(value)) {
      record.route = value;
    } else if (key === "outcome" && ["success", "failure", "rejected"].includes(value)) {
      record.outcome = value;
    } else if (key === "errorCode" && typeof value === "string" && SAFE_ERROR_CODES.has(value)) {
      record.errorCode = value;
    } else if (["statusCode", "durationMs", "claimed", "succeeded", "failed"].includes(key)
      && Number.isSafeInteger(value) && value >= 0) {
      record[key] = value;
    }
  }

  sink(JSON.stringify(record));
}

module.exports = { getRequestId, logOperationalEvent };
