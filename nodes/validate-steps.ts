import { findOperation } from "./registry";
import type { RegisteredWorkflowStep } from "./workflow-runner";

export function validateRegisteredSteps(value: unknown): { steps?: RegisteredWorkflowStep[]; error?: string } {
  if (!Array.isArray(value) || value.length < 1 || value.length > 30) return { error: "Registry workflows require between 1 and 30 steps." };
  const steps: RegisteredWorkflowStep[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return { error: "Each registry step must be an object." };
    const step = candidate as Record<string, unknown>;
    const branchValue = step.branch;
    if (typeof step.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(step.id) || seen.has(step.id) ||
      typeof step.nodeId !== "string" || typeof step.operationId !== "string" ||
      (step.kind !== "trigger" && step.kind !== "action") || !("input" in step) ||
      (branchValue !== undefined && (!branchValue || typeof branchValue !== "object" || Array.isArray(branchValue) ||
        typeof (branchValue as Record<string, unknown>).fromStepId !== "string" ||
        typeof (branchValue as Record<string, unknown>).route !== "string" ||
        !/^[a-zA-Z0-9_-]{1,64}$/.test((branchValue as Record<string, unknown>).fromStepId as string) ||
        !/^[a-zA-Z0-9_-]{1,40}$/.test((branchValue as Record<string, unknown>).route as string)))) {
      return { error: "Registry steps must have unique IDs, a registered operation, a kind, and input." };
    }
    const branch = branchValue as { fromStepId: string; route: string } | undefined;
    if (branch) {
      const sourceStep = steps.find((item) => item.id === branch.fromStepId);
      if (!sourceStep || !["if", "switch"].includes(sourceStep.nodeId)) return { error: "Branch source must be an earlier IF or Switch step." };
    }
    const operation = findOperation(step.nodeId, step.operationId, step.kind);
    if (!operation) return { error: "Unknown registry operation: " + step.nodeId + "." + step.operationId + "." };
    const parsed = operation.inputSchema.safeParse(step.input);
    if (!parsed.success) return { error: "Invalid input for registry step " + step.id + "." };
    steps.push({ id: step.id, nodeId: step.nodeId, operationId: step.operationId, kind: step.kind, input: parsed.data, ...(branch ? { branch } : {}) });
    seen.add(step.id);
  }
  if (steps[0].kind !== "trigger" || steps.filter((step) => step.kind === "trigger").length !== 1) {
    return { error: "A registry workflow must contain exactly one trigger as its first step." };
  }
  return { steps };
}
