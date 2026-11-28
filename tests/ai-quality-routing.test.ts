import test from "node:test";
import assert from "node:assert/strict";
import { assessAIModelQualification, AI_QUALITY_BENCHMARK_VERSION, AI_QUALITY_THRESHOLDS } from "../lib/ai/quality/policy";
import { applyQualityAwareRouting } from "../lib/ai/quality/routing";
import type { AIModelQualification, AIModelQualityStore } from "../lib/ai/quality/types";
import type { AIQualityMetrics } from "../lib/ai/quality/types";

const metrics: AIQualityMetrics = {
  schemaValidRate: .999, workflowGraphCorrectness: .99, toolCallAccuracy: .99,
  taskAccuracy: .99, p95LatencyMs: 1000, costPerSuccessfulOperationUsd: .001,
  recoveryRate: 1, successfulOperations: 20,
};
function q(provider: "gemini" | "groq", task: "workflow_generation" | "summarization", model: string): AIModelQualification {
  return { provider, model, task, benchmarkVersion: AI_QUALITY_BENCHMARK_VERSION, datasetSha256: "a".repeat(64),
    sampleCount: 20, recoverySampleCount: 4, metrics, thresholds: AI_QUALITY_THRESHOLDS[task],
    eligible: true, evaluatedAt: new Date().toISOString() };
}
test("quality qualification rejects models below required task accuracy", () => {
  assert.equal(assessAIModelQualification("workflow_generation", { ...metrics, taskAccuracy: .7 }, 20, 4).eligible, false);
});
test("quality qualification requires enough independent recovery probes", () => {
  assert.equal(assessAIModelQualification("summarization", { ...metrics }, 20, 2).eligible, false);
});
test("only benchmark-qualified fallback providers are eligible", async () => {
  const store: AIModelQualityStore = { listEligibleModels: async () => [q("groq", "workflow_generation", "llama-3.3-70b-versatile")], recordEvaluation: async () => ({ eligible: true, reasons: [] }) };
  const routes = [{ provider: { id: "gemini" }, primaryModel: "gemini-2.5-flash", fallbackModels: ["gemini-2.5-pro"] },
    { provider: { id: "groq" }, primaryModel: "llama-3.3-70b-versatile", fallbackModels: [] }] as never;
  const out = await applyQualityAwareRouting(routes, "workflow_generation", store);
  assert.equal(out.length, 1);
  assert.equal(out[0].provider.id, "groq");
  assert.equal(out[0].primaryModel, "llama-3.3-70b-versatile");
});
test("quality-store outage never enables an unqualified alternate", async () => {
  const store: AIModelQualityStore = { listEligibleModels: async () => { throw Error("offline"); }, recordEvaluation: async () => ({ eligible: false, reasons: [] }) };
  const routes = [{ provider: { id: "gemini" }, primaryModel: "gemini-2.5-flash", fallbackModels: ["gemini-2.5-pro"] },
    { provider: { id: "groq" }, primaryModel: "llama", fallbackModels: [] }] as never;
  const out = await applyQualityAwareRouting(routes, "summarization", store);
  assert.equal(out.length, 1); assert.deepEqual(out[0].fallbackModels, []);
});
test("quality routing rechecks recorded metrics against current hard thresholds", async () => {
  const unqualified = { ...q("groq", "summarization", "llama"), metrics: { ...metrics, taskAccuracy: .5 } };
  const store: AIModelQualityStore = { listEligibleModels: async () => [unqualified], recordEvaluation: async () => ({ eligible: false, reasons: [] }) };
  const routes = [{ provider: { id: "gemini" }, primaryModel: "gemini", fallbackModels: [] },
    { provider: { id: "groq" }, primaryModel: "llama", fallbackModels: [] }] as never;
  const out = await applyQualityAwareRouting(routes, "summarization", store);
  assert.equal(out.length, 1);
});

test("quality routing promotes a qualified alternate over an unqualified configured primary", async () => {
  const store: AIModelQualityStore = {
    listEligibleModels: async () => [q("groq", "summarization", "llama")],
    recordEvaluation: async () => ({ eligible: true, reasons: [] }),
  };
  const routes = [
    { provider: { id: "gemini" }, primaryModel: "gemini", fallbackModels: ["gemini-lite"] },
    { provider: { id: "groq" }, primaryModel: "llama", fallbackModels: [] },
  ] as never;
  const out = await applyQualityAwareRouting(routes, "summarization", store);
  assert.equal(out.length, 1);
  assert.equal(out[0].provider.id, "groq");
});

test("quality-ranked candidates are ordered by task score, then configured provider priority", async () => {
  const fastGroq = {
    ...q("groq", "summarization", "llama"),
    metrics: { ...metrics, taskAccuracy: .95, p95LatencyMs: 500 },
  };
  const accurateGemini = {
    ...q("gemini", "summarization", "gemini"),
    metrics: { ...metrics, taskAccuracy: .99, p95LatencyMs: 1000 },
  };
  const store: AIModelQualityStore = {
    listEligibleModels: async () => [fastGroq, accurateGemini],
    recordEvaluation: async () => ({ eligible: true, reasons: [] }),
  };
  const routes = [
    { provider: { id: "gemini" }, primaryModel: "gemini", fallbackModels: [] },
    { provider: { id: "groq" }, primaryModel: "llama", fallbackModels: [] },
  ] as never;
  const out = await applyQualityAwareRouting(routes, "summarization", store);
  assert.equal(out[0].provider.id, "gemini");
});

test("without any qualified model the configured primary remains the sole compatibility route", async () => {
  const store: AIModelQualityStore = {
    listEligibleModels: async () => [],
    recordEvaluation: async () => ({ eligible: false, reasons: ["not_qualified"] }),
  };
  const routes = [
    { provider: { id: "gemini" }, primaryModel: "gemini", fallbackModels: ["gemini-lite"] },
    { provider: { id: "groq" }, primaryModel: "llama", fallbackModels: [] },
  ] as never;
  const out = await applyQualityAwareRouting(routes, "summarization", store);
  assert.equal(out.length, 1);
  assert.equal(out[0].provider.id, "gemini");
  assert.deepEqual(out[0].fallbackModels, []);
});
