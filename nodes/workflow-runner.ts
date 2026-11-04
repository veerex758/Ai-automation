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
  initialOutputs?: Record<string, unknown>;
  completedStepIds?: string[];
  onStepStart?: (step: RegisteredWorkflowStep, position: number, input: unknown) => Promise<void>;
  onStepComplete?: (step: RegisteredWorkflowStep, position: number, result: RegisteredStepResult) => Promise<void>;
}): Promise<{ status: "succeeded" | "failed" | "waiting"; steps: RegisteredStepResult[]; outputs: Record<string, unknown>; resumeAt?: string }> {
  const outputs: Record<string, unknown> = { ...(args.initialOutputs ?? {}) };
  const completedStepIds = new Set(args.completedStepIds ?? []);
  const results: RegisteredStepResult[] = [];
  const seen = new Set<string>();
  const loopOutputs = new Map<string, unknown[]>();
  let checkpointPosition = 0;
  let loopExecutionCount = 0;

  for (const step of args.steps) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(step.id) || seen.has(step.id)) {
      results.push({ stepId: step.id, status: "failed", error: "INVALID_STEP_ID" });
      for (const remaining of args.steps.slice(results.length)) results.push({ stepId: remaining.id, status: "skipped", error: "PREVIOUS_STEP_FAILED" });
      return { status: "failed", steps: results, outputs };
    }
    seen.add(step.id);
    if (completedStepIds.has(step.id)) {
      if (Array.isArray(outputs[step.id])) loopOutputs.set(step.id, outputs[step.id] as unknown[]);
      results.push({ stepId: step.id, status: "succeeded", output: outputs[step.id] });
      continue;
    }
    if (step.branch) {
      const source = outputs[step.branch.fromStepId];
      if (!source || typeof source !== "object" || !Object.prototype.hasOwnProperty.call(source, "route")) {
        results.push({ stepId: step.id, status: "failed", error: "WORKFLOW_BRANCH_SOURCE_NOT_FOUND" });
        for (const remaining of args.steps.slice(results.length)) results.push({ stepId: remaining.id, status: "skipped", error: "PREVIOUS_STEP_FAILED" });
        return { status: "failed", steps: results, outputs };
      }
      if ((source as Record<string, unknown>).route !== step.branch.route) {
        const skipped: RegisteredStepResult = { stepId: step.id, status: "skipped", error: "BRANCH_NOT_SELECTED" };
        await args.onStepComplete?.(step, ++checkpointPosition, skipped);
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
      const executeOnce = async (scope: Record<string, unknown>, iteration?: number) => {
        const localOutputs = { ...outputs, ...scope };
        const input = resolveReferences(step.input, localOutputs, args.dryRun);
        const validatedInput = operation.inputSchema.parse(input);
        const checkpointStep = iteration === undefined ? step : { ...step, id: step.id + "__loop_" + (iteration + 1) };
        const position = ++checkpointPosition;
        await args.onStepStart?.(checkpointStep, position, validatedInput);
        if (args.dryRun) {
          await args.onStepComplete?.(checkpointStep, position, { stepId: checkpointStep.id, status: "simulated" });
          return { simulated: true as const };
        }
        const output = await operation.run({ ...args.context, previousOutputs: localOutputs }, validatedInput);
        const parsed = operation.outputSchema.parse(output);
        await args.onStepComplete?.(checkpointStep, position, { stepId: checkpointStep.id, status: "succeeded", output: parsed });
        return { simulated: false as const, output: parsed };
      };
      if (step.loop) {
        const source = outputs[step.loop.sourceStepId];
        const items = Array.isArray(source) ? source : source && typeof source === "object" && Array.isArray((source as Record<string, unknown>).items) ? (source as { items: unknown[] }).items : source && typeof source === "object" && (source as Record<string, unknown>).data && typeof (source as Record<string, unknown>).data === "object" && Array.isArray(((source as { data: Record<string, unknown> }).data).items) ? ((source as { data: { items: unknown[] } }).data.items) : null;
        if (!items) throw new Error("WORKFLOW_LOOP_SOURCE_NOT_ARRAY");
        const max = Math.min(100, Math.max(1, step.loop.maxIterations ?? 100));
        if (items.length > max) throw new Error("WORKFLOW_LOOP_LIMIT_EXCEEDED");
        const aggregate: unknown[] = [];
        for (let index = 0; index < items.length; index++) {
          const iterationContext: Record<string, unknown> = { ...outputs };
          for (const [priorStepId, priorItems] of loopOutputs) if (priorItems.length > index) iterationContext[priorStepId] = priorItems[index];
          loopExecutionCount++;
          if (loopExecutionCount > 500) throw new Error("WORKFLOW_LOOP_EXECUTION_BUDGET_EXCEEDED");
          const scope = { ...iterationContext, [step.loop.itemAs ?? "loop_item"]: items[index], [step.loop.indexAs ?? "loop_index"]: index };
          const iteration = await executeOnce(scope, index);
          if (!iteration.simulated) aggregate.push(iteration.output);
        }
        outputs[step.id] = args.dryRun ? { iterations: items.length, simulated: true } : aggregate;
        if (!args.dryRun) loopOutputs.set(step.id, aggregate);
        const loopCompleted: RegisteredStepResult = { stepId: step.id, status: args.dryRun ? "simulated" : "succeeded", output: outputs[step.id] };
        if (!args.dryRun) await args.onStepComplete?.(step, ++checkpointPosition, loopCompleted);
        results.push(loopCompleted);
        continue;
      }
      const once = await executeOnce({});
      if (once.simulated) { results.push({ stepId: step.id, status: "simulated" }); continue; }
      outputs[step.id] = once.output;
      results.push({ stepId: step.id, status: "succeeded", output: outputs[step.id] });
      if (step.nodeId === "wait" && step.operationId === "delay" && once.output && typeof once.output === "object" && typeof (once.output as Record<string, unknown>).resumeAt === "string") {
        return { status: "waiting", steps: results, outputs, resumeAt: (once.output as Record<string, unknown>).resumeAt as string };
      }
    } catch (error) {
      const code = error instanceof Error ? error.message : "NODE_EXECUTION_FAILED";
      results.push({ stepId: step.id, status: "failed", error: code });
      for (const remaining of args.steps.slice(results.length)) results.push({ stepId: remaining.id, status: "skipped", error: "PREVIOUS_STEP_FAILED" });
      return { status: "failed", steps: results, outputs };
    }
  }

  return { status: "succeeded", steps: results, outputs };
}
