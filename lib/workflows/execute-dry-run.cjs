const { validateDefinition } = require("./validate-definition.cjs");

const forbiddenPathSegments = new Set(["__proto__", "prototype", "constructor"]);

function readPath(input, path) {
  if (typeof path !== "string" || path.length < 1 || path.length > 120) return undefined;
  const segments = path.split(".");
  if (segments.some((segment) => !/^[a-zA-Z0-9_-]{1,64}$/.test(segment) || forbiddenPathSegments.has(segment))) {
    return undefined;
  }
  let current = input;
  for (const segment of segments) {
    if (current === null || typeof current !== "object" || !Object.hasOwn(current, segment)) return undefined;
    current = current[segment];
  }
  return current;
}

function isSet(value) {
  return value !== undefined && value !== null && value !== "";
}

function compareCondition(actual, operator, expected) {
  if (operator === "is_set") return isSet(actual);
  if (!isSet(actual)) return false;
  if (operator === "equals") return String(actual) === expected;
  if (operator === "contains") {
    if (typeof actual === "string") return actual.includes(expected);
    if (Array.isArray(actual)) return actual.some((item) => item !== null && String(item) === expected);
    return false;
  }
  if (operator === "greater_than" || operator === "less_than") {
    const actualNumber = typeof actual === "number" ? actual : Number(actual);
    const expectedNumber = Number(expected);
    if (!Number.isFinite(actualNumber) || !Number.isFinite(expectedNumber) || String(actual).trim() === "") return false;
    return operator === "greater_than" ? actualNumber > expectedNumber : actualNumber < expectedNumber;
  }
  return false;
}

/**
 * Execute a workflow in safe dry-run mode. Action providers are never invoked.
 * A non-matching condition closes the linear path and marks subsequent steps skipped.
 * @param {unknown} definitionInput
 * @param {Record<string, unknown>} input
 */
function runDryRun(definitionInput, input = {}) {
  const validated = validateDefinition(definitionInput);
  if (!validated.definition) throw new Error(validated.error || "Invalid workflow definition.");
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Test input must be a JSON object.");
  }
  const serializedInput = JSON.stringify(input);
  if (serializedInput.length > 20000) throw new Error("Test input cannot exceed 20 KB.");

  const startedAt = Date.now();
  let pathClosed = false;
  const steps = validated.definition.nodes.map((node, index) => {
    if (pathClosed) {
      return {
        step_id: node.id,
        step_type: node.type,
        title: node.title,
        position: index + 1,
        status: "skipped",
        result: { reason: "A previous condition did not match." },
      };
    }

    if (node.type === "trigger") {
      return {
        step_id: node.id,
        step_type: node.type,
        title: node.title,
        position: index + 1,
        status: "simulated",
        result: {
          event: node.settings.event,
          invokedBy: "manual_test",
          message: "Trigger acknowledged in dry-run mode; no live trigger was fired.",
        },
      };
    }

    if (node.type === "condition") {
      const operator = node.settings.operator || "equals";
      const actual = readPath(input, node.settings.field);
      const matched = compareCondition(actual, operator, node.settings.value || "");
      if (!matched) pathClosed = true;
      return {
        step_id: node.id,
        step_type: node.type,
        title: node.title,
        position: index + 1,
        status: "simulated",
        result: { field: node.settings.field, operator, matched },
      };
    }

    return {
      step_id: node.id,
      step_type: node.type,
      title: node.title,
      position: index + 1,
      status: "simulated",
      result: {
        provider: node.settings.provider || "internal",
        operation: node.settings.operation || "create_task",
        simulated: true,
        message: "Action preview only. External services and side effects are disabled in dry-run mode.",
      },
    };
  });

  return {
    status: "succeeded",
    mode: "dry_run",
    durationMs: Math.max(0, Date.now() - startedAt),
    steps,
  };
}

module.exports = { runDryRun, readPath, compareCondition };
