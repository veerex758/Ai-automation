export type WorkflowNode = {
  id: string;
  type: "trigger" | "action" | "condition";
  title: string;
  description: string;
  settings: Record<string, string>;
  position?: { x: number; y: number };
};
export type ValidationResult = {
  definition?: { version: 1; nodes: WorkflowNode[]; edges: Array<{ id: string; source: string; target: string; label: "true" | "false" | "next" }> };
  error?: string;
};
export function validateDefinition(value: unknown): ValidationResult;
