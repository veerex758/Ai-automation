import { AIProviderError } from "../errors";
import type {
  AIProvider, AIProviderId, AIRequestContext, AITextRequest,
  AIStructuredRequest, AIToolRequest, AIResult, AIToolOutput,
} from "../types";

export function createUnavailableProvider(id: Exclude<AIProviderId, "gemini">, phase: string): AIProvider {
  const unavailable = (): never => {
    throw new AIProviderError({
      provider: id,
      code: "AI_PROVIDER_DISABLED",
      message: id + " adapter is reserved for " + phase + " and is not enabled.",
    });
  };
  return {
    id,
    capabilities: { text: false, structuredOutput: false, toolCalling: false },
    isConfigured: () => false,
    async generateText(_request: AITextRequest, _context: AIRequestContext): Promise<AIResult<string>> { unavailable(); },
    async generateStructured<T>(_request: AIStructuredRequest<T>, _context: AIRequestContext): Promise<AIResult<T>> { unavailable(); },
    async generateWithTools(_request: AIToolRequest, _context: AIRequestContext): Promise<AIResult<AIToolOutput>> { unavailable(); },
  };
}
