import type { z } from "zod";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type AuthConfig =
  | { type: "none" }
  | { type: "oauth2"; scopes: string[]; refresh: "managed" | "manual" }
  | { type: "apiKey"; credentialKey: string }
  | { type: "connectionString"; credentialKey: string };

export type NodeContext = {
  credentials: Readonly<Record<string, Readonly<Record<string, string>>>>;
  logger: { info(message: string, meta?: Record<string, unknown>): void; error(message: string, meta?: Record<string, unknown>): void };
  http: {
    request(args: { url: string; method: HttpMethod; headers?: Record<string, string>; body?: unknown; timeoutMs?: number; retries?: number }): Promise<{ status: number; body: unknown }>;
  };
  previousOutputs: Readonly<Record<string, unknown>>;
  webhook?: { verified: boolean };
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
