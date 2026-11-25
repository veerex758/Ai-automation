import { findOperation } from "./registry";
import type { RegisteredWorkflowStep } from "./workflow-runner";

type InputIssue = { path: string; message: string };
type OperationSchema = {
  safeParse(value: unknown): { success: true } | { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } };
  toJSONSchema(): unknown;
};

function referenceSample(schemaValue: unknown): unknown {
  if (!schemaValue || typeof schemaValue !== "object" || Array.isArray(schemaValue)) return "reference";
  const schema = schemaValue as Record<string, unknown>;
  if (Array.isArray(schema.anyOf)) {
    const option = schema.anyOf.find((item) => item && typeof item === "object" && (item as Record<string, unknown>).type !== "null");
    if (option) return referenceSample(option);
  }
  if (schema.type === "string") {
    if (schema.format === "email") return "lead@example.test";
    if (schema.format === "date-time") return "2026-01-01T00:00:00.000Z";
    return "reference";
  }
  if (schema.type === "integer" || schema.type === "number") return 1;
  if (schema.type === "boolean") return true;
  if (schema.type === "array") return [];
  if (schema.type === "object") return {};
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  return "reference";
}

function materializeReferences(value: unknown, schemaValue: unknown): unknown {
  if (typeof value === "string") {
    const match = value.match(/^\\{\\{([a-zA-Z0-9_-]{1,64}(?:\\.[a-zA-Z0-9_-]{1,64})+)\\}\\}$/);
    if (!match) return value;
    const segments = match[1].split(".");
    if (segments.some((segment) => ["__proto__", "prototype", "constructor"].includes(segment))) return value;
    return referenceSample(schemaValue);
  }
  if (Array.isArray(value)) {
    const itemSchema = schemaValue && typeof schemaValue === "object" ? (schemaValue as Record<string, unknown>).items : undefined;
    return value.map((item) => materializeReferences(item, itemSchema));
  }
  if (value && typeof value === "object") {
    const schema = schemaValue && typeof schemaValue === "object" ? schemaValue as Record<string, unknown> : {};
    const properties = schema.properties && typeof schema.properties === "object" ? schema.properties as Record<string, unknown> : {};
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, materializeReferences(item, properties[key])]));
  }
  return value;
}

/** Validate static values and schema-compatible step references without replacing the saved references. */
export function validateOperationInput(operation: { inputSchema: OperationSchema }, input: unknown): { success: true } | { success: false; issues: InputIssue[] } {
  const schema = operation.inputSchema.toJSONSchema();
  const candidate = materializeReferences(input, schema);
  const parsed = operation.inputSchema.safeParse(candidate);
  if (parsed.success) return { success: true };
  return {
    success: false,
    issues: parsed.error.issues.map((issue) => ({ path: issue.path.map(String).join(".") || "input", message: issue.message })),
  };
}

export function validateRegisteredSteps(value: unknown): { steps?: RegisteredWorkflowStep[]; error?: string } {
  if (!Array.isArray(value) || value.length < 1 || value.length > 30) return { error: "Registry workflows require between 1 and 30 steps." };
  const steps: RegisteredWorkflowStep[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return { error: "Each registry step must be an object." };
    const step = candidate as Record<string, unknown>;
    const branchValue = step.branch;
    const branchPathsValue = step.branchPaths;
    const loopValue = step.loop;
    const connectionId = step.connectionId;
    if (connectionId !== undefined && (typeof connectionId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(connectionId))) {
      return { error: "A selected connection must be a valid connection ID." };
    }
    if (typeof step.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(step.id) || seen.has(step.id) ||
      typeof step.nodeId !== "string" || typeof step.operationId !== "string" ||
      (step.kind !== "trigger" && step.kind !== "action") || !("input" in step) ||
      (branchValue !== undefined && branchPathsValue !== undefined) ||
      (branchPathsValue !== undefined && (!Array.isArray(branchPathsValue) || branchPathsValue.length < 1 || branchPathsValue.length > 60 || branchPathsValue.some((path) => !Array.isArray(path) || path.length < 1 || path.length > 30 || path.some((predicate) => !predicate || typeof predicate !== "object" || Array.isArray(predicate) || typeof (predicate as Record<string, unknown>).fromStepId !== "string" || typeof (predicate as Record<string, unknown>).route !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test((predicate as Record<string, unknown>).fromStepId as string) || !/^[a-zA-Z0-9_-]{1,40}$/.test((predicate as Record<string, unknown>).route as string))))) ||
      (branchValue !== undefined && (!branchValue || typeof branchValue !== "object" || Array.isArray(branchValue) ||
        typeof (branchValue as Record<string, unknown>).fromStepId !== "string" ||
        typeof (branchValue as Record<string, unknown>).route !== "string" ||
        !/^[a-zA-Z0-9_-]{1,64}$/.test((branchValue as Record<string, unknown>).fromStepId as string) ||
        !/^[a-zA-Z0-9_-]{1,40}$/.test((branchValue as Record<string, unknown>).route as string)))) {
      return { error: "Registry steps must have unique IDs, a registered operation, a kind, and input." };
    }
    const branch = branchValue as { fromStepId: string; route: string } | undefined;
    const branchPaths = branchPathsValue as Array<Array<{ fromStepId: string; route: string }>> | undefined;
    const loop = loopValue as { sourceStepId: string; itemAs?: string; indexAs?: string; maxIterations?: number } | undefined;
    if (loopValue !== undefined && (!loopValue || typeof loopValue !== "object" || Array.isArray(loopValue) || step.kind !== "action" || step.nodeId === "wait" || step.id.length > 50 || Object.keys(loopValue).some((key) => !["sourceStepId", "itemAs", "indexAs", "maxIterations"].includes(key)) || typeof loop?.sourceStepId !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(loop.sourceStepId) || (loop.itemAs !== undefined && (typeof loop.itemAs !== "string" || !/^[a-zA-Z][a-zA-Z0-9_]{0,30}$/.test(loop.itemAs))) || (loop.indexAs !== undefined && (typeof loop.indexAs !== "string" || !/^[a-zA-Z][a-zA-Z0-9_]{0,30}$/.test(loop.indexAs))) || (loop.maxIterations !== undefined && (!Number.isInteger(loop.maxIterations) || loop.maxIterations < 1 || loop.maxIterations > 100)))) return { error: "Invalid loop configuration." };
    if (loop && !steps.some((item) => item.id === loop.sourceStepId)) return { error: "Loop source must be an earlier step." };
    const predicates = branchPaths?.flat() ?? (branch ? [branch] : []);
    for (const predicate of predicates) {
      const sourceStep = steps.find((item) => item.id === predicate.fromStepId);
      if (!sourceStep || !["if", "switch"].includes(sourceStep.nodeId)) return { error: "Branch source must be an earlier IF or Switch step." };
    }
    const operation = findOperation(step.nodeId, step.operationId, step.kind);
    if (!operation) return { error: "Unknown registry operation: " + step.nodeId + "." + step.operationId + "." };
    const parsed = validateOperationInput(operation, step.input);
    if (!parsed.success) return { error: "Invalid input for registry step " + step.id + " (" + step.nodeId + "." + step.operationId + "): " + parsed.issues.map((issue) => issue.path + ": " + issue.message).join("; ") };
    steps.push({ id: step.id, nodeId: step.nodeId, operationId: step.operationId, kind: step.kind, input: step.input, ...(typeof connectionId === "string" ? { connectionId } : {}), ...(branch ? { branch } : {}), ...(branchPaths ? { branchPaths } : {}), ...(loop ? { loop } : {}) });
    seen.add(step.id);
  }
  if (steps[0].kind !== "trigger" || steps.filter((step) => step.kind === "trigger").length !== 1) {
    return { error: "A registry workflow must contain exactly one trigger as its first step." };
  }
  return { steps };
}
