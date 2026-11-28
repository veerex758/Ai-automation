import { randomUUID } from "node:crypto";
import { AIProviderError } from "../lib/ai/errors";
import { createAIGateway } from "../lib/ai/gateway";
import { InMemoryCircuitBreakerStore } from "../lib/ai/circuit-breaker";
import { createDefaultAIProviderRegistry, AIProviderRegistry } from "../lib/ai/registry";
import { routeAIRequests } from "../lib/ai/router";
import { SupabaseAIModelQualityStore } from "../lib/ai/quality/store";
import type { AIModelQualityStore } from "../lib/ai/quality/types";
import type { AIProvider, AIProviderId, AIRequestContext, AITextRequest, AIStructuredRequest, AIToolRequest } from "../lib/ai/types";
import type { AITask } from "../lib/ai/types";
import type { AIQualityCase } from "../lib/ai/quality/benchmark-dataset";
import { AI_QUALITY_TASKS, getAIQualityCases } from "../lib/ai/quality/benchmark-dataset";
import { benchmarkDatasetSha256, qualifyBenchmark } from "./ai-quality-benchmark";
import type { BenchmarkObservation } from "./ai-quality-benchmark";

type Pricing = { inputUsdPer1MTokens: number; outputUsdPer1MTokens: number };
type Cli = { provider: AIProviderId; task: AITask; model?: string; recoveryProbes: number; dryRun: boolean };

const noQualificationStore: AIModelQualityStore = {
  listEligibleModels: async () => [],
  recordEvaluation: async () => ({ eligible: false, reasons: ["benchmark_probe_store_is_read_only"] }),
};

function parseCli(argv: string[]): Cli {
  const values = new Map<string, string>();
  for (const token of argv) {
    if (!token.startsWith("--")) throw new Error("Unknown argument: " + token);
    const [key, ...rest] = token.slice(2).split("=");
    values.set(key, rest.join("=") || "true");
  }
  const task = values.get("task");
  const provider = (values.get("provider") || process.env.AI_PRIMARY_PROVIDER || "gemini") as AIProviderId;
  if (!AI_QUALITY_TASKS.includes(task as AITask)) {
    throw new Error("Pass --task=<" + AI_QUALITY_TASKS.join("|") + ">; use one task per benchmark run.");
  }
  if (!["gemini", "groq", "cloudflare"].includes(provider)) throw new Error("Unsupported provider.");
  const recoveryProbes = Number(values.get("recovery-probes") ?? "3");
  if (!Number.isSafeInteger(recoveryProbes) || recoveryProbes < 3 || recoveryProbes > 10) {
    throw new Error("--recovery-probes must be an integer from 3 to 10.");
  }
  return {
    task: task as AITask, provider, model: values.get("model"),
    recoveryProbes, dryRun: values.get("dry-run") === "true",
  };
}

function pricingFor(provider: AIProviderId, model: string): Pricing | null {
  const raw = process.env.AI_QUALITY_PRICING_JSON;
  if (!raw) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("AI_QUALITY_PRICING_JSON must be valid JSON."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("AI_QUALITY_PRICING_JSON must be an object keyed by provider/model.");
  }
  const entry = (parsed as Record<string, unknown>)[provider + "/" + model];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const row = entry as Record<string, unknown>;
  const input = row.inputUsdPer1MTokens;
  const output = row.outputUsdPer1MTokens;
  if (typeof input !== "number" || !Number.isFinite(input) || input < 0 ||
      typeof output !== "number" || !Number.isFinite(output) || output < 0) {
    throw new Error("Pricing for " + provider + "/" + model + " must contain non-negative input/output USD per 1M token rates.");
  }
  return { inputUsdPer1MTokens: input, outputUsdPer1MTokens: output };
}

function usageCost(usage: { inputTokens: number; outputTokens: number; providerCostUsd?: number }, pricing: Pricing | null): number | null {
  if (typeof usage.providerCostUsd === "number" && Number.isFinite(usage.providerCostUsd) && usage.providerCostUsd >= 0) {
    return usage.providerCostUsd;
  }
  if (!pricing) return null;
  return (usage.inputTokens * pricing.inputUsdPer1MTokens +
    usage.outputTokens * pricing.outputUsdPer1MTokens) / 1_000_000;
}

function contextFor(task: AITask): AIRequestContext {
  return { task, operationId: randomUUID(), timeoutMs: 30_000 };
}

async function invokeProvider(provider: AIProvider, model: string, benchmarkCase: AIQualityCase, context: AIRequestContext) {
  if (benchmarkCase.mode === "text") {
    return provider.generateText({
      model, systemPrompt: benchmarkCase.systemPrompt, prompt: benchmarkCase.prompt, temperature: 0,
      maxOutputTokens: 700,
    }, context);
  }
  if (benchmarkCase.mode === "tools") {
    return provider.generateWithTools({
      model, systemPrompt: benchmarkCase.systemPrompt, prompt: benchmarkCase.prompt,
      tools: benchmarkCase.tools ?? [], toolChoice: "required", temperature: 0, maxOutputTokens: 700,
    }, context);
  }
  const request: AIStructuredRequest<Record<string, unknown>> = {
    model, systemPrompt: benchmarkCase.systemPrompt, prompt: benchmarkCase.prompt,
    schema: { type: "object" }, temperature: 0, maxOutputTokens: 900,
    validate: (value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("AI_BENCHMARK_OUTPUT_NOT_OBJECT");
      return value as Record<string, unknown>;
    },
  };
  return provider.generateStructured(request, context);
}

async function invokeGateway(gateway: ReturnType<typeof createAIGateway>, benchmarkCase: AIQualityCase, context: AIRequestContext) {
  if (benchmarkCase.mode === "text") {
    return gateway.generateText({
      systemPrompt: benchmarkCase.systemPrompt, prompt: benchmarkCase.prompt, temperature: 0, maxOutputTokens: 700,
    }, context);
  }
  if (benchmarkCase.mode === "tools") {
    return gateway.generateWithTools({
      systemPrompt: benchmarkCase.systemPrompt, prompt: benchmarkCase.prompt,
      tools: benchmarkCase.tools ?? [], toolChoice: "required", temperature: 0, maxOutputTokens: 700,
    }, context);
  }
  return gateway.generateStructured({
    systemPrompt: benchmarkCase.systemPrompt, prompt: benchmarkCase.prompt,
    schema: { type: "object" }, temperature: 0, maxOutputTokens: 900,
    validate: (value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("AI_BENCHMARK_OUTPUT_NOT_OBJECT");
      return value as Record<string, unknown>;
    },
  }, context);
}

async function runObservation(
  provider: AIProvider, model: string, benchmarkCase: AIQualityCase, pricing: Pricing | null,
): Promise<BenchmarkObservation> {
  const started = Date.now();
  try {
    const result = await invokeProvider(provider, model, benchmarkCase, contextFor(benchmarkCase.task));
    const grade = benchmarkCase.grade(result.output);
    return {
      ...grade, latencyMs: Math.max(0, Date.now() - started),
      costUsd: usageCost(result.usage, pricing),
    };
  } catch {
    return {
      schemaValid: benchmarkCase.mode === "text" ? null : false,
      taskCorrect: false,
      ...(benchmarkCase.task === "workflow_generation" ? { workflowGraphCorrectness: false } : {}),
      ...(benchmarkCase.task === "agent_tool_calling" ? { toolCallAccuracy: false } : {}),
      latencyMs: Math.max(0, Date.now() - started), costUsd: null,
    };
  }
}

function faultOnce(provider: AIProvider): AIProvider {
  let shouldFail = true;
  const inject = async <T>(operation: () => Promise<T>): Promise<T> => {
    if (shouldFail) {
      shouldFail = false;
      throw new AIProviderError({
        provider: provider.id, code: "AI_PROVIDER_OVERLOADED", status: 503,
        message: "Controlled benchmark fault injection: transient overload.",
      });
    }
    return operation();
  };
  return {
    id: provider.id, capabilities: provider.capabilities, isConfigured: () => provider.isConfigured(),
    generateText: (request: AITextRequest, context: AIRequestContext) =>
      inject(() => provider.generateText(request, context)),
    generateStructured: <T>(request: AIStructuredRequest<T>, context: AIRequestContext) =>
      inject(() => provider.generateStructured(request, context)),
    generateWithTools: (request: AIToolRequest, context: AIRequestContext) =>
      inject(() => provider.generateWithTools(request, context)),
  };
}

async function runRecoveryProbe(
  provider: AIProvider, model: string, benchmarkCase: AIQualityCase, env: Record<string, string | undefined>,
): Promise<boolean> {
  const registry = new AIProviderRegistry();
  registry.register(faultOnce(provider));
  const modelVariable = provider.id === "gemini" ? "GEMINI_AI_MODEL" : "GROQ_AI_MODEL";
  const probeEnv = {
    ...env, [modelVariable]: model, NODE_ENV: "test", AI_PRIMARY_PROVIDER: provider.id, AI_FAILOVER_ORDER: "",
    AI_CIRCUIT_FAILURE_THRESHOLD: "5",
  };
  const gateway = createAIGateway(
    registry, probeEnv, new InMemoryCircuitBreakerStore(), noQualificationStore,
  );
  try {
    await invokeGateway(gateway, benchmarkCase, contextFor(benchmarkCase.task));
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  try {
    const cli = parseCli(process.argv.slice(2));
    const env = process.env as Record<string, string | undefined>;
    const registry = createDefaultAIProviderRegistry(env);
    const routes = routeAIRequests(cli.task, registry, { ...env, AI_PRIMARY_PROVIDER: cli.provider });
    const route = routes.find((candidate) => candidate.provider.id === cli.provider);
    if (!route || !route.provider.isConfigured()) throw new Error("Selected provider is not configured for this task.");
    const model = cli.model || route.primaryModel;
    if (!/^[a-zA-Z0-9._:/-]{1,100}$/.test(model)) throw new Error("Invalid model identifier.");
    const cases = getAIQualityCases(cli.task);
    if (cases.length < 20) throw new Error("The task dataset must contain at least 20 cases before qualification.");
    const pricing = pricingFor(cli.provider, model);
    const observations: BenchmarkObservation[] = [];
    for (const benchmarkCase of cases) {
      observations.push(await runObservation(route.provider, model, benchmarkCase, pricing));
    }
    for (let i = 0; i < cli.recoveryProbes; i += 1) {
      const recovered = await runRecoveryProbe(route.provider, model, cases[i % cases.length], env);
      observations.push({
        schemaValid: null, taskCorrect: false, latencyMs: 0, costUsd: null,
        recoveryProbeSucceeded: recovered,
      });
    }
    const qualification = qualifyBenchmark(cli.task, observations, benchmarkDatasetSha256(cases));
    const result = {
      provider: cli.provider, model, task: cli.task, benchmarkVersion: qualification.benchmarkVersion,
      datasetSha256: qualification.datasetSha256, sampleCount: cases.length,
      recoverySampleCount: qualification.recoverySampleCount, metrics: qualification.metrics,
      eligible: qualification.eligible, reasons: qualification.reasons,
      pricingSource: pricing ? "AI_QUALITY_PRICING_JSON" : "provider-reported-cost-only",
      persisted: false,
    };
    if (!cli.dryRun) {
      if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
        throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to persist a benchmark. Use --dry-run for evaluation without persistence.");
      }
      const saved = await new SupabaseAIModelQualityStore().recordEvaluation({
        provider: cli.provider, model, task: cli.task, benchmarkVersion: qualification.benchmarkVersion,
        datasetSha256: qualification.datasetSha256, sampleCount: cases.length,
        recoverySampleCount: qualification.recoverySampleCount,
        metrics: qualification.metrics, thresholds: qualification.thresholds,
      });
      Object.assign(result, { eligible: saved.eligible, reasons: saved.reasons, persisted: true });
    }
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    if (!result.eligible) process.exitCode = 2;
  } catch (error) {
    process.stderr.write((error instanceof Error ? error.message : "AI benchmark failed.") + "\n");
    process.exitCode = 1;
  }
}

void main();
