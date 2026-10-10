declare module "*.cjs" {
  export function runDryRun(definition: unknown, input?: Record<string, unknown>): {
    status: "succeeded";
    mode: "dry_run";
    durationMs: number;
    steps: Array<{
      step_id: string;
      step_type: "trigger" | "action" | "condition";
      title: string;
      position: number;
      status: "simulated" | "skipped" | "failed";
      result: Record<string, unknown>;
    }>;
  };
}
