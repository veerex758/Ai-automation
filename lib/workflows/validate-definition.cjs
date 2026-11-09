/* global module */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- This validator is CommonJS and consumes the shared CommonJS catalog.
const { findAction } = require("./action-catalog.cjs");
const nodeTypes = new Set(["trigger", "action", "condition"]);
const idPattern = /^[a-zA-Z0-9_-]{1,64}$/;
const maxNodes = 30;
const edgeLabels = new Set(["true", "false", "next"]);

/**
 * @typedef {{ id: string, type: "trigger" | "action" | "condition", title: string, description: string, settings: Record<string, string>, position?: { x: number, y: number } }} WorkflowNode
 * @typedef {{ id: string, source: string, target: string, label?: "true" | "false" | "next" }} WorkflowEdge
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
  /** @type {Workflo¶»§q«^