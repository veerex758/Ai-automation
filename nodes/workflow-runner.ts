import { findOperation } from "./registry";
import type { NodeContext } from "./types";

export type RegisteredWorkflowStep = {
  id: string;
  nodeId: string;
  operationId: string;
  kind: "trigger" | "action";
  input: unknown;
  branch?: { fromStepId: string; route: string };
  loop?: { sourceStepId: string; itemAs?: string; indexAs?: string; maxIterations?: number };
};

export type RegisteredStepResult = {
  stepId: string;
  status: "simulated" | "succeeded" | "failed" | "skipped";
  output?: unknown;
  error?: string;
};

function resolveReferences(value: unknown, outputs: Readonly<Record<string, unknown>>, dryRun = false): unknown {
  const resolvePath = (path: string): unknown => {
    const [stepId, ...parts] = path.split(".");
    if (["__proto__", "prototype", "constructor"].includes(stepId) || parts.some((part) => ["__proto__", "prototype", "constructor"].includes(part))) {
      if (dryRun) return "[dry-run reference: " + path + "]";
      throw new Error("WORKFLOW_REFERENCE_NOT_FOUND");
    }
    let current: unknown = outputs[stepId];
    for (const part of parts) {
      if (!current || typeof current !== "object" || Array.isArray(current) || !Object.prototype.hasOwnProperty.call(current, part)) {
        if (dryRun) return "[dry-run reference: " + path + "]";
        throw new Error("WORKFLOW_REFERENCE_NOT_FOUND");
      }
      current = (current as Record<string, unknown>)[part];
    }
    if (current === null || current === undefined) {
      if (dryRun)¶»§q«^