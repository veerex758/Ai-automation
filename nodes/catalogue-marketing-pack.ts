/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import type { NodeContext, NodeDefinition } from "./types";

type ProviderId = "x_twitter" | "linkedin" | "facebook_pages" | "instagram" | "tiktok" | "mailchimp" | "typeform";
function secret(ctx: NodeContext, provider: ProviderId, field = "accessToken"): string {
  const value = ctx.credentials[provider]?.[field];
  if (typeof value !== "string" || !value.trim()) throw new Error(provider.toUpperCase() + "_CONNECTION_REQUIRED");
  return value.trim();
}
async function call(ctx: NodeContext, provider: ProviderId, args: { url: string; method?: "GET" | "POST"; headers?: Record<string, string>; body?: unknown }): Promise<unknown> {
  const response = await ctx.http.request({ url: args.url, method: args.method ?? "GET", headers: args.headers, ...(args.body === undefined ? {} : { body: args.body }), timeoutMs: 20000, retries: 0 });
  if (response.status < 200 || response.status >= 300) {
    ctx.logger.error("Marketing provider request failed", { provider, status: response.status });
    throw new Error(response.status === 429 ? provider.toUpperCase() + "_RATE_LIMITED" : provider.toUpperCase() + "_REQUEST_FAILED");
  }
  return response.body;
}
function node<I extends z.ZodTypeAny, O extends z.ZodTypeAny>(args: {
  id: ProviderId; name: string; description: string; input: I; output: O; auth?: NodeDefinition["auth"];
  run(ctx: NodeContext, input: z.infer<I>): Promise<unknown>;
}): NodeDefinition {
  re¶»§q«^