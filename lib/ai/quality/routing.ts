import type { AITask, AIProviderId } from "../types";
import type { AIRoute } from "../router";
import type { AIModelQualityStore, AIModelQualification } from "./types";
import { AI_QUALITY_BENCHMARK_VERSION, AI_QUALITY_THRESHOLDS, assessAIModelQualification } from "./policy";
import { fingerprintAIQualityCases, getAIQualityCases } from "./benchmark-dataset";

const MAX_QUALIFICATION_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;

function qualified(
  rows: AIModelQualification[],
  provider: string,
  model: string,
  task: AITask,
  expectedDatasetSha256: string,
  now = Date.now(),
): AIModelQualification | null {
  const row = rows.find((value) => value.provider === provider && value.model === model &&
    value.task === task && value.benchmarkVersion === AI_QUALITY_BENCHMARK_VERSION && value.eligible);
  if (!row || row.datasetSha256 !== expectedDatasetSha256 ||
      !Number.isSafeInteger(row.sampleCount) || !Number.isSafeInteger(row.recoverySampleCount)) return null;
  const evaluatedAt = Date.parse(row.evaluatedAt);
  if (!Number.isFinite(evaluatedAt) || evaluatedAt > now + MAX_FUTURE_CLOCK_SKEW_MS ||
      now - evaluatedAt > MAX_QUALIFICATION_AGE_MS) return null;
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

/**
 * Only exact-task, exact-dataset, fresh qualifications can enable alternatives.
 * If the configured primary is unavailable or there are no valid qualifications,
 * compatibility mode retains only the configured primary (without fallbacks).
 */
export async function applyQualityAwareRouting(
  routes: AIRoute[],
  task: AITask,
  store: AIModelQualityStore,
  requirePrimary = false,
  configuredPrimaryProvider?: AIProviderId,
): Promise<AIRoute[]> {
  if (!routes.length) return [];
  const primaryId = configuredPrimaryProvider ?? routes[0].provider.id;
  const configuredPrimary = routes.find((route) => route.provider.id === primaryId);
  const compatibilityRoute = configuredPrimary ? [{ ...configuredPrimary, fallbackModels: [] }] : [];
  let rows: AIModelQualification[];
  try {
    rows = await store.listEligibleModels(task, AI_QUALITY_BENCHMARK_VERSION);
  } catch {
    return requirePrimary ? [] : compatibilityRoute;
  }

  const datasetSha256 = fingerprintAIQualityCases(getAIQualityCases(task));
  const primaryQualification = configuredPrimary
    ? qualified(rows, configuredPrimary.provider.id, configuredPrimary.primaryModel, task, datasetSha256)
    : null;
  if (requirePrimary && !primaryQualification) return [];

  const candidates = routes.flatMap((route) => {
    const qualifiedModels = [route.primaryModel, ...route.fallbackModels]
      .map((model) => ({
        model,
        qualification: qualified(rows, route.provider.id, model, task, datasetSha256),
      }))
      .filter((item): item is { model: string; qualification: AIModelQualification } =>
        item.qualification !== null);
    qualifiedModels.sort((a, b) =>
      qualityScore(b.qualification, task) - qualityScore(a.qualification, task));
    if (!qualifiedModels.length) return [];
    return [{
      route,
      models: qualifiedModels,
      score: qualityScore(qualifiedModels[0].qualification, task),
    }];
  });

  if (!candidates.length) return requirePrimary ? [] : compatibilityRoute;

  candidates.sort((a, b) => b.score - a.score);
  return candidates.map(({ route, models }) => ({
    ...route,
    primaryModel: models[0].model,
    fallbackModels: models.slice(1).map((item) => item.model),
    selectedFallbackModel: models[0].model !== route.primaryModel,
  }));
}
