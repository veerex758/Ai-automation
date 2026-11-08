export type WorkflowNode = {
  id: string;
  type: "trigger" | "action" | "condition";
  title: string;
  description: string;
  settings: Record<string, string>;
};
export type ValidationResult = {
  definition?: { version: 1; nodes: WorkflowNode[] };
  error?: string;
};
export function validateDefinition(value: unknown): ValidationResult;
