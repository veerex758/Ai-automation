import { findOperation } from "./registry";
import type { NodeContext } from "./types";

export type RegisteredWorkflowStep = {
  id: string;
  nodeId: string;
  operationId: string;
  kind: "trigger" | "action";
  input: unknown;
  /** Optional selected workspace credential ID; resolved and authorized by the server route. */
  credentialId?: string;
  /** Server-resolved credential material; never persisted in workflow definitions or returned to clients. */
  credential?: Record<string, string>;
};

export type RegisteredStepResult = {
  stepId: string;
  status: "simulated" | "succeeded" | "failed" | "skipped";
  output?: unknown;
  error?: string;
};

function resolveReferences(value: unknown, outputs: Readonly<Record<string, unknown>>, dryRun = false): unknown {
  const lookup = (path: string): unknown => {
    const [stepId, ...parts] = path.split(".");
    let current: unknown = outputs[stepId];
    for (const part of parts) {
      if (!current || typeof current !== "object" || Array.isArray(current) ||
          !Object.prototype.hasOwnProperty.call(current, part)) return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  };

  if (typeof value === "string") {
    const exact = value.match(/^\{\{([a-zA-Z0-9_-]{1,64}(?:\.[a-zA-Z0-9_-]{1,64})*)\}\}$/);
    if (exact) {
      const resolved = lookup(exact[1]);
      if (resolved === undefined || resolved === null) {
        if (dryRun) return "[dry-run reference: " + exact[1] + "]";
        throw new Error("WORKFLOW_REFERENCE_NOT_FOUND");
      }
      return resolved;
    }
    return value.replace(/\{\{([a-zA-Z0-9_-]{1,64}(?:\.[a-zA-Z0-9_-]{1,64})*)\}\}/g, (_match, path: string) => {
      const current = lookup(path);
      if (current === undefined || current === null) {
        if (dryRun) return "[dry-run reference: " + path + "]";
        throw new Error("WORKFLOW_REFERENCE_NOT_FOUND");
      }
      if (typeof current === "string") return current;
      return JSON.stringify(current) ?? "";
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
}): Promise<{ status: "succeeded" | "failed"; steps: RegisteredStepResult[]; outputs: Record<string, unknown> }> {
  const outputs: Record<string, unknown> = {};
  const results: RegisteredStepResult[] = [];
  if (args.steps.length === 0 || args.steps.length > 30) {
    return { status: "failed", steps: [{ stepId: "", status: "failed", error: "WORKFLOW_STEP_LIMIT_EXCEEDED" }], outputs };
  }
  const seen = new Set<string>();
  for (const step of args.steps) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(step.id) || seen.has(step.id)) {
      return { status: "failed", steps: args.steps.map((item, index) => ({ stepId: item.id, status: index === 0 ? "failed" as const : "skipped" as const, error: index === 0 ? "WORKFLOW_PREFLIGHT_FAILED" : "PREFLIGHT_FAILED" })), outputs };
    }
    if (!findOperation(step.nodeId, step.operationId, step.kind)) {
      return { status: "failed", steps: args.steps.map((item, index) => ({ stepId: item.id, status: index === 0 ? "failed" as const : "skipped" as const, error: index === 0 ? "NODE_OPERATION_NOT_FOUND" : "PREFLIGHT_FAILED" })), outputs };
    }
    seen.add(step.id);
  }
  seen.clear();

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
      const input = resolveReferences(step.input, outputs, args.dryRun);
      const validatedInput = operation.inputSchema.parse(input);
      if (args.dryRun) {
        results.push({ stepId: step.id, status: "simulated" });
        continue;
      }
      const provider = step.nodeId === "email" ? "resend" : step.nodeId;
      const credentials = step.credential
        ? { ...args.context.credentials, [provider]: { ...(args.context.credentials[provider] ?? {}), ...step.credential } }
        : args.context.credentials;
      const output = await operation.run({ ...args.context, credentials, previousOutputs: outputs }, validatedInput);
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
