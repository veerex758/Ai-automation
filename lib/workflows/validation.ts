export type WorkflowStepKind = "Trigger" | "Action" | "Condition";
export type ValidationIssue = { path: string; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const kinds = new Set<WorkflowStepKind>(["Trigger", "Action", "Condition"]);

export function validateWorkflowDefinition(input: unknown): { valid: boolean; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  if (!isRecord(input)) {
    return { valid: false, issues: [{ path: "$", message: "Expected a workflow object." }] };
  }

  if (typeof input.name !== "string" || !input.name.trim()) {
    issues.push({ path: "name", message: "Give the workflow a name." });
  } else if (input.name.trim().length > 80) {
    issues.push({ path: "name", message: "Name must be 80 characters or fewer." });
  }

  if (!Array.isArray(input.steps)) {
    issues.push({ path: "steps", message: "Steps must be an array." });
    return { valid: false, issues };
  }
  if (input.steps.length === 0) issues.push({ path: "steps", message: "Add at least one step." });
  if (input.steps.length > 100) issues.push({ path: "steps", message: "A workflow cannot exceed 100 steps." });

  const ids = new Set<string>();
  let triggerCount = 0;
  input.steps.slice(0, 100).forEach((step, index) => {
    const path = `steps[${index}]`;
    if (!isRecord(step)) {
      issues.push({ path, message: "Each step must be an object." });
      return;
    }

    const id = step.id;
    if ((typeof id !== "string" && typeof id !== "number") ||
        (typeof id === "string" && !id.trim()) ||
        (typeof id === "number" && !Number.isFinite(id))) {
      issues.push({ path: `${path}.id`, message: "Each step needs a valid ID." });
    } else {
      const key = String(id);
      if (ids.has(key)) issues.push({ path: `${path}.id`, message: "Step IDs must be unique." });
      ids.add(key);
    }

    if (typeof step.kind !== "string" || !kinds.has(step.kind as WorkflowStepKind)) {
      issues.push({ path: `${path}.kind`, message: "Choose Trigger, Action, or Condition." });
    } else if (step.kind === "Trigger") {
      triggerCount += 1;
    }

    if (typeof step.title !== "string" || !step.title.trim()) {
      issues.push({ path: `${path}.title`, message: "Every step needs a name." });
    } else if (step.title.trim().length > 120) {
      issues.push({ path: `${path}.title`, message: "Step names must be 120 characters or fewer." });
    }

    if (step.detail !== undefined && typeof step.detail !== "string") {
      issues.push({ path: `${path}.detail`, message: "Step descriptions must be text." });
    } else if (typeof step.detail === "string" && step.detail.length > 500) {
      issues.push({ path: `${path}.detail`, message: "Step descriptions must be 500 characters or fewer." });
    }
  });

  if (input.steps.length > 0 && triggerCount === 0) {
    issues.push({ path: "steps", message: "Add at least one trigger to define how the workflow starts." });
  }
  return { valid: issues.length === 0, issues };
}
