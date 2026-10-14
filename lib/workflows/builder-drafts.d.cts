type BuilderDraftStep = { id: number; kind: "Trigger" | "Action" | "Condition"; title: string; detail: string };
type BuilderDraft = { name: string; steps: BuilderDraftStep[] };
declare const builderDrafts: {
  normalizeDraftName(value: unknown): string;
  isValidDraftSteps(value: unknown): value is BuilderDraftStep[];
  allocateStepIds(existingSteps: readonly { id: number }[], count?: number, now?: number): number[];
  loadBuilderDrafts(currentRaw: string | null, legacyRaw: string | null): Record<string, BuilderDraft>;
};
export = builderDrafts;
