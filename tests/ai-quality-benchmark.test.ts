import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AI_QUALITY_BENCHMARK_CASES, AI_QUALITY_TASKS, getAIQualityCases } from "../lib/ai/quality/benchmark-dataset";
import { benchmarkDatasetSha256, qualifyBenchmark, summarizeBenchmark } from "../scripts/ai-quality-benchmark";
import type { BenchmarkObservation } from "../scripts/ai-quality-benchmark";

test("each AI task has twenty deterministic, independently gradable benchmark cases", () => {
  assert.equal(AI_QUALITY_BENCHMARK_CASES.length, 160);
  for (const task of AI_QUALITY_TASKS) {
    const cases = getAIQualityCases(task);
    assert.equal(cases.length, 20, task + " sample count");
    for (const benchmarkCase of cases) {
      assert.equal(benchmarkCase.grade(benchmarkCase.expected).taskCorrect, true, benchmarkCase.id);
    }
  }
});
test("workflow graph grader rejects cycles even when every step is connected", () => {
  const benchmarkCase = getAIQualityCases("workflow_generation")[0];
  const expected = benchmarkCase.expected as { registrySteps: Array<{ id: string }>; edges: Array<{ id: string; source: string; target: string; label: string }> };
  const cyclic = {
    ...expected,
    edges: [...expected.edges, {
      id: "reverse-edge", source: expected.registrySteps[1].id,
      target: expected.registrySteps[0].id, label: "next",
    }],
  };
  assert.equal(benchmarkCase.grade(cyclic).taskCorrect, false);
});
test("benchmark dataset fingerprint is stable and task-specific", () => {
  const lead = getAIQualityCases("lead_qualification");
  assert.equal(benchmarkDatasetSha256(lead), benchmarkDatasetSha256(lead));
  assert.notEqual(benchmarkDatasetSha256(lead), benchmarkDatasetSha256(getAIQualityCases("data_extraction")));
});
test("recovery rate uses all controlled probes as its denominator", () => {
  const observations: BenchmarkObservation[] = [
    ...Array.from({ length: 20 }, (_, i) => ({
      schemaValid: true, taskCorrect: true, latencyMs: 100 + i, costUsd: .002,
    })),
    { schemaValid: null, taskCorrect: false, latencyMs: 0, costUsd: null, recoveryProbeSucceeded: true },
    { schemaValid: null, taskCorrect: false, latencyMs: 0, costUsd: null, recoveryProbeSucceeded: true },
    { schemaValid: null, taskCorrect: false, latencyMs: 0, costUsd: null, recoveryProbeSucceeded: false },
    { schemaValid: null, taskCorrect: false, latencyMs: 0, costUsd: null, recoveryProbeSucceeded: true },
  ];
  const result = qualifyBenchmark("lead_qualification", observations, "a".repeat(64));
  assert.equal(result.recoverySampleCount, 4);
  assert.equal(result.metrics.recoveryRate, .75);
  assert.equal(result.metrics.taskAccuracy, 1);
  assert.equal(result.metrics.p95LatencyMs, 118, "recovery probes must not affect measured p95 latency");
  assert.ok(Math.abs((result.metrics.costPerSuccessfulOperationUsd ?? Number.POSITIVE_INFINITY) - .002) < 1e-12);
});
test("partial missing cost data cannot produce a falsely cheap per-success cost", () => {
  const metrics = summarizeBenchmark([
    { schemaValid: null, taskCorrect: true, latencyMs: 100, costUsd: .001 },
    { schemaValid: null, taskCorrect: true, latencyMs: 110, costUsd: null },
  ]);
  assert.equal(metrics.costPerSuccessfulOperationUsd, null);
});
test("benchmark migration restricts table and RPC access to service_role", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261128130000_rexnora_ai_model_quality_qualification.sql"), "utf8");
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all on private\.ai_model_qualifications from public,anon,authenticated,service_role/i);
  assert.match(sql, /auth\.role\(\)<>'service_role'/i);
  assert.match(sql, /grant execute on function public\.record_ai_model_evaluation\(jsonb\) to service_role/i);
  assert.match(sql, /grant execute on function public\.list_eligible_ai_models\(text,text\) to service_role/i);
});
