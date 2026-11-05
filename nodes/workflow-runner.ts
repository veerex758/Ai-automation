import { findOperation } from "./registry";
import type { NodeContext } from "./types";

export type RegisteredWorkflowStep = { id: string; nodeId: string; operationId: string; kind: "trigger" | "action"; input: unknown };
export type RegisteredStepResult = { stepId: string; status: "simulated" | "succeeded" | "failed" | "skipped"; output?: unknown; error?: string };

function resolveReferences(value: unknown, outputs: Readonly<Record<string, unknown>>, dryRun = false): unknown {
  if (typeof value === "string") return value.replace(/\{\{([a-zA-Z0-9_-]{1,64}(?:\.[a-zA-Z0-9_-]{1,64})*)\}\}/g, (_match, path: string) => {
    const [stepId, ...parts] = path.split(".");
    let current: unknown = outputs[stepId];
    for (const part of parts) {
      if (!current || typeof current !== "object" || Array.isArray(current) || !Object.prototype.hasOwnProperty.call(current, part)) {
        if (dryRun) return "[dry-run reference: " + path + "]";
        throw new Error("WORKFLOW_REFERENCE_NOT_FOUND");
      }
      current = (current as Record<string, unknown>)[part];
    }
    if (current === null || current === undefined) { if (dryRun) return "[dry-run reference: " + path + "]"; throw new Error("WORKFLOW_REFERENCE_NOT_FOUND"); }
    return typeof current === "string" ? current : JSON.stringify(current);
  });
  if (Array.isArray(value)) return value.map((item) => resolveReferences(item, outputs, dryRun));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveReferences(item, outputs, dryRun)]));
  return value;
}

function validateLoopBody(outerOutputs: Record<string, unknown>, input: { items: unknown[]; bodySteps: Array<{ id: string; nodeId: string; operationId: string; input: unknown }> }) {
  for (let index = 0; index < input.items.length; index++) {
    const local: Record<string, unknown> = { ...outerOutputs, item: "[dry-run item]", index };
    const seen = new Set<string>();
    for (const body of input.bodySteps) {
      if (body.nodeId === "loop" || !/^[a-zA-Z0-9_-]{1,64}$/.test(body.id) || seen.has(body.id) ||
        body.id === "item" || body.id === "index" || Object.prototype.hasOwnProperty.call(outerOutputs, body.id)) {
        throw new Error("LOOP_BODY_INVALID_OR_NESTED_LOOP");
      }
      seen.add(body.id);
      const operation = findOperation(body.nodeId, body.operationId, "action");
      if (!operation) throw new Error("LOOP_BODY_OPERATION_NOT_FOUND");
      const resolved = resolveReferences(body.input, local, true);
      operation.inputSchema.parse(resolved);
      local[body.id] = "[dry-run output]";
    }
  }
}

function resolveLoopReferences(value: unknown, outputs: Readonly<Record<string, unknown>>, item: unknown, index: number): unknown {
  if (typeof value === "string") {
    return value.replace(/\\{\\{(item|index)\\}\\}/g, (_match, key: string) => {
      const resolved = key === "item" ? item : index;
      return typeof resolved === "string" ? resolved : JSON.stringify(resolved);
    }).replace(/\\{\\{([a-zA-Z0-9_-]{1,64}(?:\\.[a-zA-Z0-9_-]{1,64})+)\\}\\}/g, (_match, path: string) => {
      const [stepId, ...parts] = path.split(".");
      let current: unknown = outputs[stepId];
      for (const part of parts) {
        if (!current || typeof current !== "object" || Array.isArray(current) || !Object.prototype.hasOwnProperty.call(current, part)) throw new Error("WORKFLOW_REFERENCE_NOT_FOUND");
        current = (current as Record<string, unknown>)[part];
      }
      if (current === null || current === undefined) throw new Error("WORKFLOW_REFERENCE_NOT_FOUND");
      return typeof current === "string" ? current : JSON.stringify(current);
    });
  }
  if (Array.isArray(value)) return value.map((entry) => resolveLoopReferences(entry, outputs, item, index));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, resolveLoopReferences(entry, outputs, item, index)]));
  return value;
}

async function runLoop(ctx: Omit<NodeContext, "previousOutputs">, outerOutputs: Record<string, unknown>, input: { items: unknown[]; bodySteps: Array<{ id: string; nodeId: string; operationId: string; input: unknown }> }) {
  const iterations: Array<{ item: unknown; index: number; outputs: Record<string, unknown> }> = [];
  for (let index = 0; index < input.items.length; index++) {
    const local: Record<string, unknown> = { ...outerOutputs, item: input.items[index], index };
    const seen = new Set<string>();
    for (const body of input.bodySteps) {
      if (body.nodeId === "loop" || !/^[a-zA-Z0-9_-]{1,64}$/.test(body.id) || seen.has(body.id) || body.id === "item" || body.id === "index" || Object.prototype.hasOwnProperty.call(outerOutputs, body.id)) throw new Error("LOOP_BODY_INVALID_OR_NESTED_LOOP");
      seen.add(body.id);
      const op = findOperation(body.nodeId, body.operationId, "action");
      if (!op) throw new Error("LOOP_BODY_OPERATION_NOT_FOUND");
      const resolved = resolveLoopReferences(body.input, local, input.items[index], index);
      const parsed = op.inputSchema.parse(resolved);
      const output = op.outputSchema.parse(await op.run({ ...ctx, previousOutputs: local }, parsed));
      local[body.id] = output;
    }
    const iterationOutputs = Object.fromEntries(Object.entries(local).filter(([key]) => !Object.prototype.hasOwnProperty.call(outerOutputs, key) && key !== "item" && key !== "index"));
    iterations.push({ item: input.items[index], index, outputs: iterationOutputs });
  }
  return { iterations: iterations.length, results: iterations };
}

/** Dry-run validates registered operations and never invokes provider or loop body code. */
export async function executeRegisteredWorkflow(args: { steps: RegisteredWorkflowStep[]; context: Omit<NodeContext, "previousOutputs">; dryRun: boolean }): Promise<{ status: "succeeded" | "failed"; steps: RegisteredStepResult[]; outputs: Record<string, unknown> }> {
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
    const operation = findOperation(step.nodeId, step.operationId, step.kind);
    if (!operation) {
      results.push({ stepId: step.id, status: "failed", error: "NODE_OPERATION_NOT_FOUND" });
      for (const remaining of args.steps.slice(results.length)) results.push({ stepId: remaining.id, status: "skipped", error: "PREVIOUS_STEP_FAILED" });
      return { status: "failed", steps: results, outputs };
    }
    try {
      // Loop body templates are scoped to each iteration. Resolve only the
      // collection against outer outputs here; resolving the entire body first
      // would incorrectly look up {{item}} before an iteration exists.
      const rawInput = step.nodeId === "loop" && step.operationId === "each" &&
        step.input && typeof step.input === "object" && !Array.isArray(step.input)
        ? { ...(step.input as Record<string, unknown>), items: resolveReferences((step.input as Record<string, unknown>).items, outputs, args.dryRun) }
        : resolveReferences(step.input, outputs, args.dryRun);
      const validated = operation.inputSchema.parse(rawInput);
      if (args.dryRun) {
        if (step.nodeId === "loop" && step.operationId === "each") {
          validateLoopBody(outputs, validated as { items: unknown[]; bodySteps: Array<{ id: string; nodeId: string; operationId: string; input: unknown }> });
        }
        results.push({ stepId: step.id, status: "simulated" });
        continue;
      }
      const output = step.nodeId === "loop" && step.operationId === "each"
        ? await runLoop(args.context, outputs, validated as { items: unknown[]; bodySteps: Array<{ id: string; nodeId: string; operationId: string; input: unknown }> })
        : await operation.run({ ...args.context, previousOutputs: outputs }, validated);
      outputs[step.id] = operation.outputSchema.parse(output);
      results.push({ stepId: step.id, status: "succeeded", output: outputs[step.id] });
    } catch (error) {
      const code = error instanceof Error ? error.message : "NODE_EXECUTION_FAILED";
      results.push({ stepId: step.id, status: "failed", error: code });
      for (const remaining of args.steps.slice(results.length)) results.push({ stepId: remaining.id, status: "skipped", error: "PREVIOUS_STEP_FAILED" });
      return { status: "failed", steps: results, outputs };
    }
  }
  return { status: "succeeded", steps: results, outputs };
}