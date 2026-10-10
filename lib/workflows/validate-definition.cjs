/* global module */
const nodeTypes = new Set(["trigger", "action", "condition"]);
const idPattern = /^[a-zA-Z0-9_-]{1,64}$/;
const maxNodes = 30;

/**
 * @typedef {{ id: string, type: "trigger" | "action" | "condition", title: string, description: string, settings: Record<string, string> }} WorkflowNode
 * @typedef {{ definition?: { version: 1, nodes: WorkflowNode[] }, error?: string }} ValidationResult
 */

/** @param {unknown} value @returns {ValidationResult} */
function validateDefinition(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "Workflow definition must be an object." };
  const input = /** @type {Record<string, unknown>} */ (value);
  if (input.version !== 1 || !Array.isArray(input.nodes)) return { error: "Use workflow definition version 1 with a nodes array." };
  if (input.nodes.length === 0) return { error: "Add a trigger before saving this workflow." };
  if (input.nodes.length > maxNodes) return { error: `A workflow can contain at most ${maxNodes} steps.` };

  const ids = new Set();
  /** @type {WorkflowNode[]} */
  const nodes = [];
  for (const candidate of input.nodes) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return { error: "Each workflow step must be an object." };
    const node = /** @type {Record<string, unknown>} */ (candidate);
    if (typeof node.id !== "string" || !idPattern.test(node.id) || ids.has(node.id)) return { error: "Each step needs a unique, valid ID." };
    if (typeof node.type !== "string" || !nodeTypes.has(node.type)) return { error: "Each step must be a trigger, action, or condition." };
    if (typeof node.title !== "string" || node.title.trim().length < 1 || node.title.trim().length > 80) return { error: "Step titles must be between 1 and 80 characters." };
    if (typeof node.description !== "string" || node.description.trim().length > 240) return { error: "Step descriptions cannot exceed 240 characters." };
    const type = /** @type {WorkflowNode["type"]} */ (node.type);
    const rawSettings = node.settings === undefined ? {} : node.settings;
    if (!rawSettings || typeof rawSettings !== "object" || Array.isArray(rawSettings)) return { error: "Step settings must be an object." };
    const allowedSettings = type === "action"
      ? ["provider", "operation", "recipient", "message", "url"]
      : type === "condition"
        ? ["field", "operator", "value"]
        : ["event"];
    /** @type {Record<string, string>} */
    const settings = {};
    for (const [key, settingValue] of Object.entries(/** @type {Record<string, unknown>} */ (rawSettings))) {
      if (!allowedSettings.includes(key) || typeof settingValue !== "string" || settingValue.length > 500) {
        return { error: "Step settings contain an unsupported field or an invalid value." };
      }
      settings[key] = settingValue.trim();
    }
    if (type === "trigger") {
      if (settings.event && !["manual", "schedule", "webhook", "record_created"].includes(settings.event)) return { error: "Choose a supported trigger event." };
      if (!settings.event) return { error: "Choose what starts this workflow." };
    }
    if (type === "action") {
      if (settings.provider && !["email", "slack", "webhook", "internal"].includes(settings.provider)) return { error: "Choose a supported action provider." };
      if (settings.operation && !["send_email", "send_message", "http_request", "create_task"].includes(settings.operation)) return { error: "Choose a supported action operation." };
      const provider = settings.provider ?? "internal";
      const operation = settings.operation ?? "create_task";
      const compatibleOperations = { internal: "create_task", email: "send_email", slack: "send_message", webhook: "http_request" };
      if (compatibleOperations[provider] !== operation) return { error: "Choose an operation that matches the selected service." };
      if (operation === "send_email") {
        if (!settings.recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.recipient)) return { error: "Enter a valid recipient email address." };
      }
      if (operation === "send_message" && !settings.recipient) return { error: "Enter a Slack channel or recipient." };
      if (operation === "http_request") {
        if (!settings.url) return { error: "Enter a request URL." };
        try { const url = new URL(settings.url); if (url.protocol !== "https:") return { error: "Request URLs must use HTTPS." }; } catch { return { error: "Enter a valid HTTPS request URL." }; }
      }
    }
    if (type === "condition") {
      if (settings.operator && !["equals", "contains", "greater_than", "less_than", "is_set"].includes(settings.operator)) return { error: "Choose a supported condition operator." };
      if (!settings.field) return { error: "Enter the field this condition should check." };
      if ((settings.operator ?? "equals") !== "is_set" && !settings.value) return { error: "Enter an expected value for this condition." };
    }
    ids.add(node.id);
    nodes.push({ id: node.id, type, title: node.title.trim(), description: node.description.trim(), settings });
  }
  if (nodes.length > 0 && nodes[0].type !== "trigger") return { error: "The first step must be a trigger." };
  if (nodes.filter((node) => node.type === "trigger").length > 1) return { error: "A workflow can only have one trigger." };
  return { definition: { version: 1, nodes } };
}

module.exports = { validateDefinition };
