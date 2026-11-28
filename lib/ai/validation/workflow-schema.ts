import { z } from "zod";
import { AIProviderError } from "../errors";
import type { AIProviderId } from "../types";

const RegistryPlanSchema = z.object({
  registrySteps: z.array(z.unknown()).min(1).max(30),
  edges: z.array(z.unknown()).max(90),
}).strict();

const LegacyDraftSchema = z.object({
  version: z.number().int(),
  nodes: z.array(z.unknown()),
  edges: z.array(z.unknown()),
}).strict();

export function parseStructuredJson<T = unknown>(
  content: unknown,
  provider: AIProviderId,
  validate?: (value: unknown, provider?: AIProviderId) => T,
): T {
  if (typeof content !== "string" || !content.trim()) {
    throw new AIProviderError({ provider, code: "AI_EMPTY_RESPONSE", message: "AI provider returned no content." });
  }
  const fence = String.fromCharCode(96).repeat(3);
  const trimmed = content.trim()
    .replace(new RegExp("^" + fence + "(?:json)?\\s*", "i"), "")
    .replace(new RegExp("\\s*" + fence + "$"), "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (cause) {
    throw new AIProviderError({ provider, code: "AI_INVALID_JSON", message: "AI provider returned invalid JSON.", cause });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AIProviderError({ provider, code: "AI_INVALID_OUTPUT", message: "Structured AI output must be a JSON object." });
  }
  return validate ? validate(parsed, provider) : parsed as T;
}

/** Envelope validation only; registered-node input and graph validation remain in the authoritative workflow API route. */
export function validateWorkflowPlannerEnvelope(value: unknown, mode: "registry" | "legacy", provider: AIProviderId): unknown {
  const result = (mode === "registry" ? RegistryPlanSchema : LegacyDraftSchema).safeParse(value);
  if (!result.success) {
    throw new AIProviderError({
      provider,
      code: "AI_UNSAFE_WORKFLOW",
      message: "Generated workflow did not match the expected response envelope.",
    });
  }
  return result.data;
}
