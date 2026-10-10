export type DryRunNode = {
  id: string;
  type: "trigger" | "action" | "condition";
  title: string;
  description: string;
  settings: Record<string, string>;
};
export type DryRunDefinition = { version: 1; nodes: DryRunNode[] };
export type DryRunStepResult = {
  stepId: string;
  position: number;
  type: DryRunNode["type"];
  title: string;
  status: "simulated" | "skipped";
  message: string;
  conditionMatched?: boolean;
};
export type DryRunResult = {
  mode: "dry_run";
  status: "succeeded";
  sideEffectsPerformed: false;
  steps: DryRunStepResult[];
};
export function runDryRun(definition: DryRunDefinition, input?: Record<string, unknown>): DryRunResult;
