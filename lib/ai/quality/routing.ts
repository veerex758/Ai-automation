import type { AITask } from "../types";
import type { AIRoute } from "../router";
import type { AIModelQualityStore, AIModelQualification } from "./types";
import { AI_QUALITY_BENCHMARK_VERSION, AI_QUALITY_THRESHOLDS, assessAIModelQualification } from "./policy";

function qualified(rows: AIModelQualification[], provider: string, model: string, task: AITask): AIModelQualification | null {
  const row = rows.find((value) => value.provider === provider && value.model === model &&
    value.task === task && value.benchmarkVersion === AI_QUALITY_BENCHMARK_VERSION && value.eligible);
  if (!row || !/^[a-f0-9]{64}$/i.test(row.datasetSha256)) return null;
  return assessAIModelQualification(
    task, row.metrics, row.sampleCount, row.recoverySampleCount, AI_QUALITY_THRESHOLDS[task],
  ).eligible ? row : null;
}

function qualityScore(row: AIModelQualification, task: AITask): number {
  const threshold = AI_QUALITY_THRESHOLDS[task];
  const metrics = row.metrics;
  const values = [
    metrics.taskAccuracy,
    metrics.recoveryRate,
    1 - Math.min(1, metrics.p95LatencyMs / threshold.maximumP95LatencyMs),
    1 - Math.min(1, (metrics.costPerSuccessfulOperationUsd ?? Number.POSITIVE_INFINITY) /
      threshold.maximumCostPerSuccessfulOperationUsd),
  ];
  if (threshold.minimumSchemaValidRate !== undefined) values.push(metrics.schemaValidRate ?? 0);
  if (threshold.minimumWorkflowGraphCorrectness !== undefined) values.push(metrics.workflowGraphCorrectness ?? 0);
  if (threshold.minimumToolCallAccuracy !== undefined) values.push(metrics.toolCallAccuracy ?? 0);
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export async function applyQualityAwareRouting(
  routes: AIRoute[], task: AITask, store: AIModelQualityStore, requirePrimary = false,
): Promise<AIRoute[]> {
  if (!routes.length) return [];
  let rows: AIModelQualification[];
  try {
    rows = await store.listEligibleModels(task, AI_QUALITY_BENCHMARK_VERSION);
  } catch {
    return requirePrimary ? [] : [{ ...routes[0], fallbackModels: [] }];
  }
  const primary = routes[0];
  const primaryQualification = qualified(rows, primary.provider.id, primary.primaryModel, task);
  if (requirePrimary && !primaryQualification) return [];
  const primaryFallbacks = primary.fallbackModels.filter((model) =>
    qualified(rows, primary.provider.id, model, task) !== null);
  const alternates = routes.slice(1).flatMap((route) => {
    const candidates = [route.primaryModel, ...route.fallbackModels]
      .map((model) => ({ model, qualification: qualified(rows, route.provider.id, model, task) }))
      .filter((item): item is { model: string; qualification: AIModelQualification } => item.qualification !== null);
    candidates.sort((a, b) => qualityScore(b.qualification, task) - qualityScore(a.qualification, task));
    return candidates.length ? [{
      ...route,
      primaryModel: candidates[0].model,
      fallbackModels: candidates.slice(1).map((item) => item.model),
    }] : [];
  });
  return [{ ...primary, fallbackModels: primaryFallbacks }, ...alternates];
}
