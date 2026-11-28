import type { AIUsage } from "./types";

function tokenCount(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/** Provider token/cost telemetry only. Customer credits are charged by the existing post-validation billing RPC. */
export function normalizeAIUsage(value: unknown): AIUsage {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const inputTokens = tokenCount(row.inputTokens ?? row.prompt_tokens ?? row.promptTokenCount);
  const outputTokens = tokenCount(row.outputTokens ?? row.completion_tokens ?? row.candidatesTokenCount);
  const reportedTotal = tokenCount(row.totalTokens ?? row.total_tokens);
  const providerCostUsd = typeof row.providerCostUsd === "number" &&
    Number.isFinite(row.providerCostUsd) && row.providerCostUsd >= 0
    ? row.providerCostUsd : undefined;
  return {
    inputTokens,
    outputTokens,
    totalTokens: reportedTotal || inputTokens + outputTokens,
    ...(providerCostUsd === undefined ? {} : { providerCostUsd }),
  };
}

export const EMPTY_AI_USAGE: AIUsage = Object.freeze({
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
});
