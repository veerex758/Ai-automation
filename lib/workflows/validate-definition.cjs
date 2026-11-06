/* global module */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- This validator is CommonJS and consumes the shared CommonJS catalog.
const { findAction } = require("./action-catalog.cjs");
const nodeTypes = new Set(["trigger", "action", "condition"]);
const idPattern = /^[a-zA-Z0-9_-]{1,64}$/;
const maxNodes = 30;

/**
 * @typedef {{ id: string, type: "trigger" | "action" | "condition", title: string, description: string, settings: Record<string, string> }} WorkflowNode
 * @typedef {{ id: string, source: string, target: string, sourceHandle?: "next" | "true" | "false" }} WorkflowEdge
 * @typedef {{ definition?: { version: 1, nodes: WorkflowNode[], edges: WorkflowEdge[] }, error?: string }} ValidationResult
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
      ? ["provider", "operation", "recipient", "message", "url", "delay"]
      : type === "condition"
        ? ["field", "operator", "value"]
        : ["event", "source"];
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
      if (settings.delay && !["immediate", "15_minutes", "1_hour", "1_day"].includes(settings.delay)) return { error: "Choose a supported follow-up delay." };
      if (settings.provider && !["email", "slack", "webhook", "internal"].includes(settings.provider)) return { error: "Choose a supported action provider." };
      if (settings.operation && !["send_email", "send_message", "http_request", "create_task"].includes(settings.operation)) return { error: "Choose a supported action operation." };
      const provider = settings.provider ?? "internal";
      const operation = settings.operation ?? "create_task";
      if (!findAction(provider, operation)) return { error: "Choose an operation that matches the selected service." };
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
  if (nodes.filter((node) => node.type === "trigger").length !== 1) return { error: "A workflow must contain exactly one trigger." };

  // Version 1 definitions written before graph edges existed are upgraded to a
  // deterministic linear graph. New definitions persist explicit connections.
  const rawEdges = input.edges === undefined
    ? nodes.slice(1).map((node, index) => ({
        id: "edge-" + (index + 1),
        source: nodes[index].id,
        target: node.id,
        sourceHandle: "next",
      }))
    : input.edges;
  if (!Array.isArray(rawEdges) || rawEdges.length > 60) return { error: "Workflow connections must be an array with at most 60 edges." };

  const edgeIds = new Set();
  const edges = [];
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  for (const candidate of rawEdges) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return { error: "Each workflow connection must be an object." };
    const edge = /** @type {Record<string, unknown>} */ (candidate);
    if (typeof edge.id !== "string" || !idPattern.test(edge.id) || edgeIds.has(edge.id) ||
        typeof edge.source !== "string" || typeof edge.target !== "string" ||
        !ids.has(edge.source) || !ids.has(edge.target) || edge.source === edge.target) {
      return { error: "Connections need unique IDs and valid, different source and target nodes." };
    }
    const sourceNode = nodes.find((node) => node.id === edge.source);
    const sourceHandle = edge.sourceHandle === undefined ? "next" : edge.sourceHandle;
    if (sourceHandle !== "next" && sourceHandle !== "true" && sourceHandle !== "false") return { error: "Choose a valid connection path." };
    if (sourceNode.type === "condition" && sourceHandle === "next") return { error: "Condition connections must use the true or false branch." };
    if (sourceNode.type !== "condition" && sourceHandle !== "next") return { error: "Only conditions can create true or false branches." };
    if (outgoing.get(edge.source).some((existing) => existing.sourceHandle === sourceHandle)) return { error: "A node can have only one connection for each output path." };
    edgeIds.add(edge.id);
    incoming.set(edge.target, incoming.get(edge.target) + 1);
    outgoing.get(edge.source).push({ sourceHandle, target: edge.target });
    edges.push({ id: edge.id, source: edge.source, target: edge.target, sourceHandle });
  }

  for (const node of nodes) {
    if (node.type === "condition") {
      const paths = outgoing.get(node.id).map((edge) => edge.sourceHandle);
      if (!paths.includes("true") || !paths.includes("false")) return { error: "Every condition needs both a true and a false branch." };
    }
  }

  // Reject cycles so the editor and downstream runner have a deterministic graph.
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) return false;
    if (visited.has(id)) return true;
    visiting.add(id);
    for (const edge of outgoing.get(id)) if (!visit(edge.target)) return false;
    visiting.delete(id);
    visited.add(id);
    return true;
  }
  if (!visit(nodes[0].id)) return { error: "Workflow connections cannot contain a cycle." };
  if (visited.size !== nodes.length) return { error: "Every workflow step must be reachable from the trigger." };

  return { definition: { version: 1, nodes, edges } };
}

module.exports = { validateDefinition };
