import type { AITask } from "../types";
import type { AIQualityMetrics, AIQualityThresholds } from "./types";

export const AI_QUALITY_BENCHMARK_VERSION = "rexnora-quality-v2";
export const AI_QUALITY_THRESHOLDS: Record<AITask, AIQualityThresholds> = {
  workflow_generation: { minimumSamples: 20, minimumRecoverySamples: 3, minimumTaskAccuracy: .9,
    minimumSchemaValidRate: .98, minimumWorkflowGraphCorrectness: .95, maximumP95LatencyMs: 20000,
    maximumCostPerSuccessfulOperationUsd: .05, minimumRecoveryRate: .75 },
  workflow_schema_repair: { minimumSamples: 20, minimumRecoverySamples: 3, minimumTaskAccuracy: .9,
    minimumSchemaValidRate: .98, maximumP95LatencyMs: 20000, maximumCostPerSuccessfulOperationUsd: .05,
    minimumRecoveryRate: .75 },
  workflow_debugging: { minimumSamples: 20, minimumRecoverySamples: 3, minimumTaskAccuracy: .9,
    maximumP95LatencyMs: 20000, maximumCostPerSuccessfulOperationUsd: .05, minimumRecoveryRate: .75 },
  lead_qualification: { minimumSamples: 20, minimumRecoverySamples: 3, minimumTaskAccuracy: .95,
    minimumSchemaValidRate: .99, maximumP95LatencyMs: 10000, maximumCostPerSuccessfulOperationUsd: .02,
    minimumRecoveryRate: .75 },
  email_drafting: { minimumSamples: 20, minimumRecoverySamples: 3, minimumTaskAccuracy: .9,
    maximumP95LatencyMs: 12000, maximumCostPerSuccessfulOperationUsd: .02, minimumRecoveryRate: .75 },
  data_extraction: { minimumSamples: 20, minimumRecoverySamples: 3, minimumTaskAccuracy: .97,
    minimumSchemaValidRate: .995, maximumP95LatencyMs: 10000, maximumCostPerSuccessfulOperationUsd: .02,
    minimumRecoveryRate: .75 },
  summarization: { minimumSamples: 20, minimumRecoverySamples: 3, minimumTaskAccuracy: .9,
    maximumP95LatencyMs: 8000, maximumCostPerSuccessfulOperationUsd: .01, minimumRecoveryRate: .75 },
  agent_tool_calling: { minimumSamples: 20, minimumRecoverySamples: 3, minimumTaskAccuracy: .95,
    minimumSchemaValidRate: .99, minimumToolCallAccuracy: .98, maximumP95LatencyMs: 12000,
    maximumCostPerSuccessfulOperationUsd: .03, minimumRecoveryRate: .75 },
};

export function assessAIModelQualification(
  task: AITask, metrics: AIQualityMetrics, sampleCount: number, recoverySampleCount: number,
  thresholds = AI_QUALITY_THRESHOLDS[task],
) {
  const reasons: string[] = [];
  if (!Number.isSafeInteger(sampleCount) || sampleCount < thresholds.minimumSamples) reasons.push("insufficient_samples");
  if (!Number.isSafeInteger(recoverySampleCount) || recoverySampleCount < thresholds.minimumRecoverySamples) {
    reasons.push("insufficient_recovery_samples");
  }
  if (!Number.isFinite(metrics.taskAccuracy) || metrics.taskAccuracy < thresholds.minimumTaskAccuracy) {
    reasons.push("task_accuracy_below_threshold");
  }
  if (thresholds.minimumSchemaValidRate !== undefined &&
      (metrics.schemaValidRate === null || !Number.isFinite(metrics.schemaValidRate) ||
       metrics.schemaValidRate < thresholds.minimumSchemaValidRate)) reasons.push("schema_validity_below_threshold");
  if (thresholds.minimumWorkflowGraphCorrectness !== undefined &&
      (metrics.workflowGraphCorrectness === null || !Number.isFinite(metrics.workflowGraphCorrectness) ||
       metrics.workflowGraphCorrectness < thresholds.minimumWorkflowGraphCorrectness)) {
    reasons.push("graph_correctness_below_threshold");
  }
  if (thresholds.minimumToolCallAccuracy !== undefined &&
      (metrics.toolCallAccuracy === null || !Number.isFinite(metrics.toolCallAccuracy) ||
       metrics.toolCallAccuracy < thresholds.minimumToolCallAccuracy)) reasons.push("tool_call_accuracy_below_threshold");
  if (!Number.isFinite(metrics.p95LatencyMs) || metrics.p95LatencyMs > thresholds.maximumP95LatencyMs) {
    reasons.push("latency_above_threshold");
  }
  if (metrics.costPerSuccessfulOperationUsd === null ||
      !Number.isFinite(metrics.costPerSuccessfulOperationUsd) ||
      metrics.costPerSuccessfulOperationUsd < 0 ||
      metrics.costPerSuccessfulOperationUsd > thresholds.maximumCostPerSuccessfulOperationUsd) {
    reasons.push("cost_above_threshold");
  }
  if (!Number.isFinite(metrics.recoveryRate) || metrics.recoveryRate < thresholds.minimumRecoveryRate) {
    reasons.push("recovery_rate_below_threshold");
  }
  return { eligible: reasons.length === 0, reasons };
}
