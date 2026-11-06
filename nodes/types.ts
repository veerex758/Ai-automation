import type { z } from "zod";

export type AuthConfig =
  | { type: "none" }
  | { type: "oauth2"; scopes: string[]; refresh: "managed" | "manual" }
  | { type: "apiKey"; credentialKey: string }
  | { type: "connectionString"; credentialKey: string };

export type NodeContext = {
  credentials: Readonly<Record<string, Readonly<Record<string, string>>>>;
  logger: { info(message: string, meta?: Record<string, unknown>): void; error(message: string, meta?: Record<string, unknown>): void };
  http: {
    request(args: { url: string; method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; headers?: Record<string, string>; body?: unknown; timeoutMs?: number; retries?: number }): Promise<{ status: number; body: unknown }>;
  };
  previousOutputs: Readonly<Record<string, unknown>>;
  webhook?: { verified: boolean };
  /** Shared atomic rate-limit backend. Missing backend fails closed. */
  rateLimit?: { consume(args: { key: string; limit: number; windowMs: number }): Promise<{ allowed: boolean; remaining: number; retryAfterMs: number }> };
};

export type NodeOperation<I extends z.ZodTypeAny = z.ZodTypeAny, O extends z.ZodTypeAny = z.ZodTypeAny> = {
  id: string;
  name: string;
  description: string;
  inputSchema: I;
  outputSchema: O;
  run(ctx: NodeContext, input: z.infer<I>): Promise<z.infer<O>>;
};

export type NodeDefinition = {
  id: string;
  name: string;
  icon: string;
  category: "triggers" | "ai" | "communication" | "data" | "developer";
  version: number;
  auth: AuthConfig;
  triggers: NodeOperation[];
  actions: NodeOperation[];
};
