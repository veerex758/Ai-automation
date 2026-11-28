import { createGeminiProvider } from "./providers/gemini";
import type { AIProvider, AIProviderId } from "./types";

export class AIProviderRegistry {
  private readonly providers = new Map<AIProviderId, AIProvider>();

  register(provider: AIProvider): void {
    if (this.providers.has(provider.id)) throw new Error("AI_PROVIDER_ALREADY_REGISTERED");
    this.providers.set(provider.id, provider);
  }

  get(providerId: AIProviderId): AIProvider | undefined {
    return this.providers.get(providerId);
  }

  list(): AIProvider[] {
    return [...this.providers.values()];
  }
}

/** Only Gemini is enabled in Phase 1. Disabled adapters are intentionally not registered. */
export function createDefaultAIProviderRegistry(env: Record<string, string | undefined> = process.env): AIProviderRegistry {
  const registry = new AIProviderRegistry();
  registry.register(createGeminiProvider({ env }));
  return registry;
}
