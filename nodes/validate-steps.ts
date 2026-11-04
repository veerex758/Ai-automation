import { findOperation } from "./registry";
import type { RegisteredWorkflowStep } from "./workflow-runner";

export function validateRegisteredSteps(value: unknown): { steps?: RegisteredWorkflowStep[]; error?: string } {
  if (!Array.isArray(value) || value.length < 1 || value.length > 30) return { error: "Registry workflows require between 1 and 30 steps." };
  const steps: RegisteredWorkflowStep[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return { error: "Each registry step must be an object." };
    const step = candidate as Record<string, unknown>;
    if (typeof step.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(step.id) || seen.has(step.id) ||
      typeof step.nodeId !== "string" || typeof step.operationId !== "string" ||
      (step.kind !== "trigger" && step.kind !== "action") || !("input" in step) ||
      (step.branch !== undefined && (!step.branch || typeof step.branch !== "object" || Array.isArray(step.branch) ||
        typeof (step.branch as Record<string, unknown>).fromStepId !== "string" ||
        typeof (step.branch as Record<string, unknown>).route !== "string" ||
        !/^[a-zA-Z0-9_-]{1,64}$/.test((step.branch as Record<string, unknown>).fromStepId as string) ||
        !/^[a-zA-Z0-9_-]{1,40}$/.test((step.branch as Record<string, unknown>).route as string)))) {
      return { error: "Registry steps must have unique IDs, a registered operation, a kind, and input." };
    }
    seen.add(step.id);
    const operation = findOperation(step.nodeId, step.operationId, step.kind);
    if (!operation) return { error: "Unknown registry operation: " + step.nodeId + "." + step.operationId + "." };
    const parsed = operation.inputSchema.safeParse(step.input);
    if (!parsed.success) return { error: "Invalid input for registry step " + step.id + "." };
    const branch = step.branch as { fromStepId: string; route: string } | undefined;\n    if (branch && !seen.has(branch.fromStepId)) return { error: "Branch source must be an earlier step." };\n    steps.push({ id: step.id, nodeId: step.nodeId, operationId: step.operationId, kind: step.kind, input: parsed.data, ...(branch ? { branch } : {}) });
  }
  if (steps[0].kind !== "trigger" || steps.filter((step) => step.kind === "trigger").length !== 1) {
    return { error: "A registry workflow must contain exactly one trigger as its first step." };
  }
  return { steps };
}
