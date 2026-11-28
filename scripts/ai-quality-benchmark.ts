import { createHash } from "node:crypto";
import type { AITask } from "../lib/ai/types";
import type { AIQualityMetrics } from "../lib/ai/quality/types";
import { AI_QUALITY_BENCHMARK_VERSION, AI_QUALITY_THRESHOLDS, assessAIModelQualification } from "../lib/ai/quality/policy";
import type { AIQualityCase } from "../lib/ai/quality/benchmark-dataset";

export type BenchmarkObservation = {
  schemaValid: boolean | null;
  taskCorrect: boolean;
  workflowGraphCorrectness?: boolean;
  toolCallAccuracy?: boolean;
  latencyMs: number;
  costUsd: number | null;
  /** Set only for an explicitly injected transient-failure recovery experiment. */
  recoveryProbeSucceeded?: boolean;
};

export function summarizeBenchmark(observations: BenchmarkObservation[]): AIQualityMetrics {
  const rate = (values: number[]): number => values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const sortedLatency = observations.map((x) => x.latencyMs)
    .filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  const p95 = sortedLatency.length
    ? sortedLatency[Math.min(sortedLatency.length - 1, Math.ceil(sortedLatency.length * 0.95) - 1)]
    : Number.POSITIVE_INFINITY;
  const successful = observations.filter((x) => x.taskCorrect);
  const successfulCosts = successful.map((x) => x.costUsd);
  const costCoverageComplete = successful.length > 0 &&
    successfulCosts.every((x) => typeof x === "number" && Number.isFinite(x) && x >= 0);
  const schemaSamples = observations.filter((x) => x.schemaValid !== null);
  const graphSamples = observations.filter((x) => x.workflowGraphCorrectness !== undefined);
  const toolSamples = observations.filter((x) => x.toolCallAccuracy !== undefined);
  const recoverySamples = observations.filter((x) => x.recoveryProbeSucceeded !== undefined);

  return {
    schemaValidRate: schemaSamples.length ? rate(schemaSamples.map((x) => Number(x.schemaValid))) : null,
    workflowGraphCorrectness: graphSamples.length ? rate(graphSamples.map((x) => Number(x.workflowGraphCorrectness))) : null,
    toolCallAccuracy: toolSamples.length ? rate(toolSamples.map((x) => Number(x.toolCallAccuracy))) : null,
    taskAccuracy: observations.length ? rate(observations.map((x) => Number(x.taskCorrect))) : 0,
    p95LatencyMs: p95,
    costPerSuccessfulOperationUsd: costCoverageComplete
      ? successfulCosts.reduce((sum, value) => sum + (value as number), 0) / successful.length
      : null,
    recoveryRate: recoverySamples.length
      ? rate(recoverySamples.map((x) => Number(x.recoveryProbeSucceeded))) : 0,
    successfulOperations: successful.length,
  };
}

export function benchmarkDatasetSha256(cases: AIQualityCase[]): string {
  const stableDataset = cases.map(({ id, task, mode, prompt, expected, tools }) => ({
    id, task, mode, prompt, expected, tools: tools ?? [],
  }));
  return createHash("sha256").update(JSON.stringify(stableDataset)).digest("hex");
}

export function qualifyBenchmark(
  task: AITask,
  observations: BenchmarkObservation[],
  datasetSha256 = createHash("sha256").update("unspecified-dataset").digest("hex"),
) {
  const metrics = summarizeBenchmark(observations);
  const thresholds = AI_QUALITY_THRESHOLDS[task];
  const recoverySampleCount = observations.filter((x) => x.recoveryProbeSucceeded !== undefined).length;
  return {
    metrics,
    thresholds,
    ...assessAIModelQualification(task, metrics, observations.length, recoverySampleCount, thresholds),
    datasetSha256,
    benchmarkVersion: AI_QUALITY_BENCHMARK_VERSION,
    recoverySampleCount,
  };
}
