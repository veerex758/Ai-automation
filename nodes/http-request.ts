import { z } from "zod";
import type { NodeDefinition } from "./types";
import { performSafeHttpRequest } from "./safe-http";

const requestInput = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
  url: z.string().url().max(2048),
  headers: z.record(z.string(), z.string()).default({}),
  body: z.unknown().optional(),
  authMode: z.enum(["none", "bearer", "api_key", "basic"]).default("none"),
  apiKeyHeader: z.string().regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,64}$/).default("Authorization"),
  timeoutMs: z.number().int().min(1000).max(30000).default(15000),
}).strict();

export const httpRequestNode: NodeDefinition = {
  id: "http_request",
  name: "HTTP Request",
  icon: "globe",
  category: "developer",
  version: 1,
  auth: { type: "apiKey", credentialKey: "http" },
  triggers: [],
  actions: [{
    id: "request",
    name: "Make HTTP request",
    description: "Calls a public HTTP(S) endpoint using workspace-scoped credentials. Private, loopback, link-local, reserved and mixed DNS answers are blocked; DNS is pinned to a validated public address, redirects are not followed, and request/response sizes and timeouts are bounded.",
    inputSchema: requestInput,
    outputSchema: z.object({ status: z.number().int(), body: z.unknown(), headers: z.record(z.string(), z.string()) }).strict(),
    async run(ctx, raw) {
      const input = requestInput.parse(raw);
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(input.headers)) {
        if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,64}$/.test(name) || /[\r\n]/.test(value) ||
            /^(authorization|proxy-authorization|cookie|host)$/i.test(name)) {
          throw new Error("HTTP_REQUEST_HEADER_NOT_ALLOWED");
        }
        headers[name] = value;
      }
      const credential = ctx.credentials.http ?? {};
      if (input.authMode === "bearer") {
        const token = credential.bearerToken ?? credential.token;
        if (!token) throw new Error("HTTP_WORKSPACE_BEARER_CREDENTIAL_REQUIRED");
        headers.Authorization = "Bearer " + token;
      } else if (input.authMode === "api_key") {
        if (!credential.apiKey) throw new Error("HTTP_WORKSPACE_API_KEY_REQUIRED");
        headers[input.apiKeyHeader] = input.apiKeyHeader.toLowerCase() === "authorization"
          ? "Bearer " + credential.apiKey : credential.apiKey;
      } else if (input.authMode === "basic") {
        if (!credential.username || !credential.password) throw new Error("HTTP_WORKSPACE_BASIC_CREDENTIALS_REQUIRED");
        headers.Authorization = "Basic " + Buffer.from(credential.username + ":" + credential.password).toString("base64");
      }
      if (input.body !== undefined && !Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) {
        headers["Content-Type"] = "application/json";
      }
      return performSafeHttpRequest({
        url: input.url,
        method: input.method,
        headers,
        body: input.body,
        timeoutMs: input.timeoutMs,
      });
    },
  }],
};
