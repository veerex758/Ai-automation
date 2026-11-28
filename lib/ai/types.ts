export type AIProviderId = "gemini" | "groq" | "cloudflare";
export type AITask =
  | "workflow_generation"
  | "workflow_schema_repair"
  | "workflow_debugging"
  | "lead_qualification"
  | "email_drafting"
  | "data_extraction"
  | "summarization"
  | "agent_tool_calling";

export type AIErrorCode =
  | "AI_NOT_CONFIGURED"
  | "AI_PROVIDER_DISABLED"
  | "AI_PROVIDER_AUTH_ERROR"
  | "AI_PROVIDER_COOLDOWN"
  | "AI_PROVIDER_CIRCUIT_UNAVAILABLE"
  | "AI_RATE_LIMITED"
  | "AI_PROVIDER_OVERLOADED"
  | "AI_TIMEOUT"
  | "AI_DEADLINE_EXCEEDED"
  | "AI_CANCELLED"
  | "AI_PROVIDER_UNAVAILABLE"
  | "AI_NETWORK_ERROR"
  | "AI_INVALID_REQUEST"
  | "AI_SAFETY_REJECTED"
  | "AI_INVALID_RESPONSE"
  | "AI_EMPTY_RESPONSE"
  | "AI_INVALID_JSON"
  | "AI_INVALID_OUTPUT"
  | "AI_UNSAFE_WORKFLOW"
  | "AI_ATTEMPT_LIMIT_REACHED"
  | "AI_PROVIDER_ERROR";

export type JSONSchema = Record<string, unknown>;

export type AIUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  providerCostUsd?: number;
};

export type AIProviderAttempt = {
  provider?: AIProviderId;
  model: string;
  attempt: number;
  status: number;
  retryAfterMs?: number;
  errorCode?: AIErrorCode;
  providerReason?: string;
  providerType?: string;
  providerRequestId?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  providerCostUsd?: number;
  fallbackUsed: boolean;
};

export type AIResult<T> = {
  output: T;
  provider: AIProviderId;
  model: string;
  requestId?: string;
  durationMs: number;
  usage: AIUsage;
  fallbackUsed: boolean;
};

export type AIRequestBudget = {
  remainingProviderAttempts: number;
  deadlineAt: number;
  totalProviderAttempts?: number;
  /** Operation-wide hard cap shared by generation and any controlled repair. */
  maxProviderAttempts?: number;
  /** Provider-specific hard cap shared by all gateway calls for this operation. */
  maxAttemptsPerProvider?: number;
  providerAttempts?: Partial<Record<AIProviderId, number>>;
};

export type AIRequestContext = {
  task: AITask;
  /** Stable for the complete logical operation, including retries and repairs. */
  operationId: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  deadlineAt?: number;
  /** A shared mutable budget spans generation and any schema-repair request. */
  attemptBudget?: AIRequestBudget;
  /** Gateway-managed attempt metadata; provider adapters must not change the operation ID. */
  providerAttempt?: number;
  fallbackUsed?: boolean;
  /** Providers blocked by a shared circuit breaker for this request. */
  excludedProviders?: AIProviderId[];
  /** Receives provider/model/status and normalized usage counters only; never include prompts or response bodies. */
  onProviderAttempt?: (attempt: AIProviderAttempt) => void;
};

export type AITextRequest = {
  systemPrompt?: string;
  prompt: string;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
};

export type AIStructuredRequest<T = unknown> = AITextRequest & {
  schema?: JSONSchema;
  validate?: (value: unknown, provider?: AIProviderId) => T;
};

export type AIToolDefinition = {
  name: string;
  description: string;
  parameters: JSONSchema;
};

export type AIToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type AIToolRequest = AITextRequest & {
  tools: AIToolDefinition[];
  toolChoice?: "auto" | "required" | "none";
};

export type AIToolOutput = {
  text: string;
  toolCalls: AIToolCall[];
  finishReason?: string;
};

export type AIProviderCapabilities = {
  text: boolean;
  structuredOutput: boolean;
  toolCalling: boolean;
};

export interface AIProvider {
  readonly id: AIProviderId;
  readonly capabilities: AIProviderCapabilities;
  isConfigured(): boolean;
  generateText(request: AITextRequest, context: AIRequestContext): Promise<AIResult<string>>;
  generateStructured<T = unknown>(request: AIStructuredRequest<T>, context: AIRequestContext): Promise<AIResult<T>>;
  generateWithTools(request: AIToolRequest, context: AIRequestContext): Promise<AIResult<AIToolOutput>>;
}
