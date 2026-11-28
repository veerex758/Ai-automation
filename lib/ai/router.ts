import { AIProviderError } from "./errors";
import type { AITask, AIProvider, AIProviderId } from "./types";
import type { AIProviderRegistry } from "./registry";

export type AIRoute = {
  provider: AIProvider;
  primaryModel: string;
  fallbackModels: string[];
};

const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
const DEFAULT_GEMINI_FALLBACK_MODEL = "gemini-3.5-flash-lite";
const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";
const DEFAULT_GROQ_FALLBACK_MODEL = "llama-3.3-70b-versatile";

function capabilityForTask(task: AITask): keyof AIProvider["capabilities"] {
  if (task === "agent_tool_calling") return "toolCalling";
  if (["workflow_generation", "workflow_schema_repair", "lead_qualification", "data_extraction"].includes(task)) {
    return "structuredOutput";
  }
  return "text";
}

function configuredModel(value: string | undefined, fallback: string): string {
  const model = (value || fallback).trim();
  if (!/^[a-zA-Z0-9._:/-]{1,100}$/.test(model)) {
    throw new AIProviderError({
      provider: "gemini",
      code: "AI_INVALID_REQUEST",
      message: "AI model configuration is invalid.",
    });
  }
  return model;
}

/**
 * Returns each configured provider at most once, in deterministic priority order.
 * Unconfigured or capability-incompatible providers are never attempted.
 */
export function routeAIRequests(
  task: AITask,
  registry: AIProviderRegistry,
  env: Record<string, string | undefined> = process.env,
  excludedProviders: AIProviderId[] = [],
): AIRoute[] {
  const primaryValue = (env.AI_PRIMARY_PROVIDER || "gemini").trim().toLowerCase();
  const allowedIds: AIProviderId[] = ["gemini", "groq", "cloudflare"];
  if (!allowedIds.includes(primaryValue as AIProviderId)) {
    throw new AIProviderError({
      provider: "gemini",
      code: "AI_INVALID_REQUEST",
      message: "AI primary-provider configuration is invalid.",
    });
  }
  const configuredOrder = (env.AI_FAILOVER_ORDER || "groq,cloudflare")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is AIProviderId => allowedIds.includes(value as AIProviderId));
  const order = [...new Set([primaryValue as AIProviderId, ...configuredOrder])];
  const excluded = new Set(excludedProviders);
  const capability = capabilityForTask(task);
  const routes: AIRoute[] = [];

  for (const providerId of order) {
    if (excluded.has(providerId)) continue;
    const provider = registry.get(providerId);
    if (!provider || !provider.isConfigured() || !provider.capabilities[capability]) continue;

    let primaryModel: string;
    let fallbackModels: string[];
    if (providerId === "gemini") {
      primaryModel = configuredModel(env.GEMINI_AI_MODEL, DEFAULT_GEMINI_MODEL);
      const fallback = configuredModel(env.GEMINI_FALLBACK_MODEL, DEFAULT_GEMINI_FALLBACK_MODEL);
      fallbackModels = fallback === primaryModel ? [] : [fallback];
    } else if (providerId === "groq") {
      primaryModel = configuredModel(env.GROQ_AI_MODEL, DEFAULT_GROQ_MODEL);
      const fallback = configuredModel(env.GROQ_FALLBACK_MODEL, DEFAULT_GROQ_FALLBACK_MODEL);
      fallbackModels = fallback === primaryModel ? [] : [fallback];
    } else {
      primaryModel = configuredModel(env.CLOUDFLARE_AI_MODEL, "@cf/meta/llama-3.1-8b-instruct");
      fallbackModels = [];
    }
    routes.push({ provider, primaryModel, fallbackModels });
  }

  if (!routes.length) {
    throw new AIProviderError({
      provider: primaryValue as AIProviderId,
      code: excluded.length ? "AI_PROVIDER_DISABLED" : "AI_NOT_CONFIGURED",
      message: "No configured AI provider supports this task.",
    });
  }
  return routes;
}

/** Backwards-compatible single-route helper; new gateway code should use routeAIRequests. */
export function routeAIRequest(
  task: AITask,
  registry: AIProviderRegistry,
  env: Record<string, string | undefined> = process.env,
): AIRoute {
  return routeAIRequests(task, registry, env)[0];
}
