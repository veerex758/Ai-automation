/* global module */
function readPath(input, path) {
  const segments = path.split(".");
  if (!segments.length || segments.some((segment) => !segment || ["__proto__", "prototype", "constructor"].includes(segment))) {
    return { found: false };
  }

  let current = input;
  for (const segment of segments) {
    if (!current || typeof current !== "object" || Array.isArray(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return { found: false };
    }
    current = current[segment];
  }
  return { found: true, value: current };
}

function comparable(value) {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return null;
}

function evaluateCondition(node, input) {
  const field = node.settings.field;
  if (!field) return false;
  const actual = readPath(input, field);
  const operator = node.settings.operator ?? "equals";

  if (operator === "is_set") return actual.found && actual.value !== null && actual.value !== undefined;
  if (!actual.found) return false;
  const expected = node.settings.value ?? "";

  if (operator === "equals") {
    const left = comparable(actual.value);
    if (left === null) return false;
    return String(left) === expected;
  }
  if (operator === "contains") return typeof actual.value === "string" && actual.value.includes(expected);
  if (operator === "greater_than" || operator === "less_than") {
    const left = typeof actual.value === "number" ? actual.value : Number(actual.value);
    const right = Number(expected);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
    return operator === "greater_than" ? left > right : left < right;
  }
  return false;
}

/**
 * Simulates a validated workflow without performing network calls, sending messages,
 * creating external tasks, or persisting arbitrary input values.
 */
function runDryRun(definition, input = {}) {
  let halted = false;
  const steps = definition.nodes.map((node, index) => {
    const position = index + 1;
    if (halted) {
      return {
        stepId: node.id,
        position,
        type: node.type,
        title: node.title,
        status: "skipped",
        message: "Skipped because an earlier condition did not match.",
      };
    }

    if (node.type === "trigger") {
      return {
        stepId: node.id,
        position,
        type: node.type,
        title: node.title,
        status: "simulated",
        message: "Trigger recognized. No external event was consumed.",
      };
    }

    if (node.type === "condition") {
      const matched = evaluateCondition(node, input);
      if (!matched) halted = true;
      return {
        stepId: node.id,
        position,
        type: node.type,
        title: node.title,
        status: "simulated",
        message: matched ? "Condition matched in dry-run." : "Condition did not match; remaining steps were skipped.",
        conditionMatched: matched,
      };
    }

    const operation = node.settings.operation ?? "create_task";
    const messages = {
      create_task: "Task creation simulated. No external task was created.",
      send_email: "Email send simulated. No email was sent.",
      send_message: "Message send simulated. No Slack message was sent.",
      http_request: "HTTP request simulated. No network request was made.",
    };
    return {
      stepId: node.id,
      position,
      type: node.type,
      title: node.title,
      status: "simulated",
      message: messages[operation] ?? "Action simulated. No external side effect occurred.",
    };
  });

  return { mode: "dry_run", status: "succeeded", sideEffectsPerformed: false, steps };
}

module.exports = { runDryRun };
