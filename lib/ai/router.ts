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

export function routeAIRequest(
  task: AITask,
  registry: AIProviderRegistry,
  env: Record<string, string | undefined> = process.env,
): AIRoute {
  // Quality routing is intentionally Gemini-only until fallback providers pass their gates.
  const providerId: AIProviderId = "gemini";
  const provider = registry.get(providerId);
  if (!provider || !provider.isConfigured()) {
    throw new AIProviderError({ provider: providerId, code: "AI_NOT_CONFIGURED", message: "The configured AI provider is unavailable." });
  }
  const capability = task === "agent_tool_calling" ? "toolCalling" :
    ["workflow_generation", "workflow_schema_repair", "lead_qualification", "data_extraction"].includes(task)
      ? "structuredOutput" : "text";
  if (!provider.capabilities[capability]) {
    throw new AIProviderError({ provider: providerId, code: "AI_PROVIDER_DISABLED", message: "The selected provider does not support this AI task." });
  }
  const primaryModel = (env.GEMINI_AI_MODEL || DEFAULT_GEMINI_MODEL).trim();
  const fallback = (env.GEMINI_FALLBACK_MODEL || DEFAULT_GEMINI_FALLBACK_MODEL).trim();
  if (!/^[a-zA-Z0-9._:/-]{1,100}$/.test(primaryModel) || !/^[a-zA-Z0-9._:/-]{1,100}$/.test(fallback)) {
    throw new AIProviderError({ provider: providerId, code: "AI_INVALID_REQUEST", message: "Gemini model configuration is invalid." });
  }
  return {
    provider,
    primaryModel,
    fallbackModels: fallback === primaryModel ? [] : [fallback],
  };
}
