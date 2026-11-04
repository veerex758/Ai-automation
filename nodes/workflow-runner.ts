import { findOperation } from "./registry";
import type { NodeContext } from "./types";

export type RegisteredWorkflowStep = {
  id: string;
  nodeId: string;
  operationId: string;
  kind: "trigger" | "action";
  input: unknown;
  branch?: { fromStepId: string; route: string };
};

export type RegisteredStepResult = {
  stepId: string;
  status: "simulated" | "succeeded" | "failed" | "skipped";
  output?: unknown;
  error?: string;
};

function resolveReferences(value: unknown, outputs: Readonly<Record<string, unknown>>, dryRun = false): unknown {
  if (typeof value === "string") {
    return value.replace(/\{\{([a-zA-Z0-9_-]{1,64}(?:\.[a-zA-Z0-9_-]{1,64})*)\}\}/g, (_match, path: string) => {
      const [stepId, ...parts] = path.split(".");
      let current: unknown = outputs[stepId];
      for (const part of parts) {
        if (!current || typeof current !== "object" || Array.isArray(current) || !Object.prototype.hasOwnProperty.call(current, part)) {
          if (dryRun) return "[dry-run reference: " + path + "]";
          throw new Error("WORKFLOW_REFERENCE_NOT_FOUND");
        }
        current = (current as Record<string, unknown>)[part];
      }
      if (current === null || current === undefined) {
        if (dryRun) return "[dry-run reference: " + path + "]";
        throw new Error("WORKFLOW_REFERENCE_NOT_FOUND");
      }
      return typeof current === "string" ? current : JSON.stringify(current);
    });
  }
  if (Array.isArray(value)) return value.map((item) => resolveReferences(item, outputs, dryRun));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveReferences(item, outputs, dryRun)]));
  }
  return value;
}

/**
 * Executes a sequence of registry operations. Dry-run validates each operation's
 * existence and input schema but never calls provider code or makes network requests.
 */
export async function executeRegisteredWorkflow(args: {
  steps: RegisteredWorkflowStep[];
  context: Omit<NodeContext, "previousOutputs">;
  dryRun: boolean;
  onStepStart?: (step: RegisteredWorkflowStep, position: number, input: unknown) => Promise<void>;
  onStepComplete?: (step: RegisteredWorkflowStep, position: number, result: RegisteredStepResult) => Promise<void>;
}): Promise<{ status: "succeeded" | "failed"; steps: RegisteredStepResult[]; outputs: Record<string, unknown> }> {
  const outputs: Record<string, unknown> = {};
  const results: RegisteredStepResult[] = [];
  const seen = new Set<string>();

  for (const step of args.steps) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(step.id) || seen.has(step.id)) {
      results.push({ stepId: step.id, status: "failed", error: "INVALID_STEP_ID" });
      for (const remaining of args.steps.slice(results.length)) results.push({ stepId: remaining.id, status: "skipped", error: "PREVIOUS_STEP_FAILED" });
      return { status: "failed", steps: results, outputs };
    }
    seen.add(step.id);
    if (step.branch) {
      const source = outputs[step.branch.fromStepId];
      if ((!source || typeof source !== "object" || !Object.prototype.hasOwnProperty.call(source, "route")) && args.dryRun) {\n        const simulated: RegisteredStepResult = { stepId: step.id, status: "simulated" };\n        await args.onStepComplete?.(step, results.length + 1, simulated);\n        results.push(simulated);\n        continue;\n      }\n      if (!source || typeof source !== "object" || !Object.prototype.hasOwnProperty.call(source, "route")) {
        results.push({ stepId: step.id, status: "failed", error: "WORKFLOW_BRANCH_SOURCE_NOT_FOUND" });
        for (const remaining of args.steps.slice(results.length)) results.push({ stepId: remaining.id, status: "skipped", error: "PREVIOUS_STEP_FAILED" });
        return { status: "failed", steps: results, outputs };
      }
      if ((source as Record<string, unknown>).route !== step.branch.route) {
        const skipped: RegisteredStepResult = { stepId: step.id, status: "skipped", error: "BRANCH_NOT_SELECTED" };
        await args.onStepComplete?.(step, results.length + 1, skipped);
        results.push(skipped);
        continue;
      }
    }
    const operation = findOperation(step.nodeId, step.operationId, step.kind);
    if (!operation) {
      results.push({ stepId: step.id, status: "failed", error: "NODE_OPERATION_NOT_FOUND" });
      for (const remaining of args.steps.slice(results.length)) results.push({ stepId: remaining.id, status: "skipped", error: "PREVIOUS_STEP_FAILED" });
      return { status: "failed", steps: results, outputs };
    }

    try {
      const input = resolveReferences(step.input, outputs, args.dryRun);
      const validatedInput = operation.inputSchema.parse(input);
      await args.onStepStart?.(step, results.length + 1, validatedInput);
      if (args.dryRun) {
        const simulated: RegisteredStepResult = { stepId: step.id, status: "simulated" };
        await args.onStepComplete?.(step, results.length + 1, simulated);
        results.push(simulated);
        continue;
      }
      const output = await operation.run({ ...args.context, previousOutputs: outputs }, validatedInput);
      outputs[step.id] = operation.outputSchema.parse(output);
      const completed: RegisteredStepResult = { stepId: step.id, status: "succeeded", output: outputs[step.id] };
      await args.onStepComplete?.(step, results.length + 1, completed);
      results.push(completed);
    } catch (error) {
      const code = error instanceof Error ? error.message : "NODE_EXECUTION_FAILED";
      results.push({ stepId: step.id, status: "failed", error: code });
      for (const remaining of args.steps.slice(results.length)) results.push({ stepId: remaining.id, status: "skipped", error: "PREVIOUS_STEP_FAILED" });
      return { status: "failed", steps: results, outputs };
    }
  }

  return { status: "succeeded", steps: results, outputs };
}
