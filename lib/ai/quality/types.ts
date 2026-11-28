import type { AIProviderId, AITask } from "../types";

export type AIQualityMetrics = {
  schemaValidRate: number | null;
  workflowGraphCorrectness: number | null;
  toolCallAccuracy: number | null;
  taskAccuracy: number;
  p95LatencyMs: number;
  costPerSuccessfulOperationUsd: number | null;
  recoveryRate: number;
  successfulOperations: number;
};
export type AIQualityThresholds = {
  minimumSamples: number;
  minimumRecoverySamples: number;
  minimumTaskAccuracy: number;
  minimumSchemaValidRate?: number;
  minimumWorkflowGraphCorrectness?: number;
  minimumToolCallAccuracy?: number;
  maximumP95LatencyMs: number;
  maximumCostPerSuccessfulOperationUsd: number;
  minimumRecoveryRate: number;
};
export type AIModelQualification = {
  provider: AIProviderId;
  model: string;
  task: AITask;
  benchmarkVersion: string;
  datasetSha256: string;
  sampleCount: number;
  recoverySampleCount: number;
  metrics: AIQualityMetrics;
  thresholds: AIQualityThresholds;
  eligible: boolean;
  evaluatedAt: string;
};
export interface AIModelQualityStore {
  listEligibleModels(task: AITask, version: string): Promise<AIModelQualification[]>;
  recordEvaluation(value: Omit<AIModelQualification, "eligible" | "evaluatedAt">): Promise<{ eligible: boolean; reasons: string[] }>;
}
