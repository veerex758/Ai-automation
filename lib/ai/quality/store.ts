import type { AITask } from "../types";
import type { AIModelQualityStore, AIModelQualification } from "./types";

function isQualification(value: unknown): value is AIModelQualification {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const metrics = row.metrics && typeof row.metrics === "object" ? row.metrics as Record<string, unknown> : null;
  return (row.provider === "gemini" || row.provider === "groq" || row.provider === "cloudflare") &&
    typeof row.model === "string" && typeof row.task === "string" &&
    typeof row.benchmarkVersion === "string" && typeof row.datasetSha256 === "string" &&
    Number.isSafeInteger(row.sampleCount) && Number.isSafeInteger(row.recoverySampleCount) &&
    row.eligible === true && !!metrics && typeof metrics.taskAccuracy === "number" &&
    typeof metrics.p95LatencyMs === "number" && typeof metrics.recoveryRate === "number";
}

export class SupabaseAIModelQualityStore implements AIModelQualityStore {
  private async client() {
    const { createAdminClient } = await import("../../supabase/admin");
    return createAdminClient();
  }

  async listEligibleModels(task: AITask, version: string): Promise<AIModelQualification[]> {
    const client = await this.client();
    const { data, error } = await client.rpc("list_eligible_ai_models", {
      p_task: task, p_benchmark_version: version,
    });
    if (error) throw new Error("AI_MODEL_QUALITY_STORE_UNAVAILABLE");
    return Array.isArray(data) ? data.filter(isQualification) : [];
  }

  async recordEvaluation(value: Omit<AIModelQualification, "eligible" | "evaluatedAt">) {
    const client = await this.client();
    const { data, error } = await client.rpc("record_ai_model_evaluation", { p_evaluation: value });
    if (error) throw new Error("AI_MODEL_QUALITY_WRITE_UNAVAILABLE");
    const row = data && typeof data === "object" ? data as { eligible?: boolean; reasons?: unknown } : {};
    return {
      eligible: row.eligible === true,
      reasons: Array.isArray(row.reasons)
        ? row.reasons.filter((reason): reason is string => typeof reason === "string") : [],
    };
  }
}
