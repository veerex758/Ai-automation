import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AIProviderError } from "../lib/ai/errors";
import { createAIGateway } from "../lib/ai/gateway";
import { createDefaultAIProviderRegistry, AIProviderRegistry } from "../lib/ai/registry";
import { routeAIRequest, routeAIRequests } from "../lib/ai/router";
import { retryDelayMs } from "../lib/ai/retry";
import { createGeminiProvider } from "../lib/ai/providers/gemini";
import { createGroqProvider } from "../lib/ai/providers/groq";
import { createCloudflareProvider } from "../lib/ai/providers/cloudflare";

const env = {
  NODE_ENV: "test",
  GEMINI_API_KEY: "test-gemini-secret",
  GEMINI_AI_MODEL: "gemini-test-model",
  GEMINI_FALLBACK_MODEL: "gemini-test-fallback",
};

const context = {
  task: "workflow_generation" as const,
  operationId: "123e4567-e89b-42d3-a456-426614174000",
  timeoutMs: 2_000,
};

function fakeFetch(payload: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return async () => new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

test("workflow generator delegates to the gateway without reading provider credentials itself", async () => {
  const { generateWorkflow } = await import("../lib/workflows/ai-workflow-generator.cjs");
  let receivedTask = "";
  const result = await generateWorkflow({
    prompt: "Start manually.",
    nodeCatalog: [],
    mode: "registry",
    env: { NODE_ENV: "test" },
    onProviderAttempt: () => undefined,
    gatewayGenerateStructured: async (request: { task: string }) => {
      receivedTask = request.task;
      return {
        parsed: {
          registrySteps: [{ id: "start", nodeId: "manual", operationId: "start", kind: "trigger", input: {} }],
          edges: [],
        },
        modelUsed: "gemini-test-model",
        fallbackUsed: false,
        usage: { inputTokens: 7, outputTokens: 4, totalTokens: 11 },
      };
    },
  });

  assert.equal(receivedTask, "workflow_generation");
  assert.equal(result.providerModelUsed, "gemini-test-model");
  assert.deepEqual(result.providerUsage, { inputTokens: 7, outputTokens: 4, totalTokens: 11 });
  assert.equal(result.saved, false);
  assert.equal(result.executed, false);
});

test("Gemini adapter implements structured generation and normalizes usage", async () => {
  let requestBody: Record<string, unknown> | undefined;
  let requestOperationId = "";
  const provider = createGeminiProvider({
    env,
    fetchImpl: async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requestOperationId = String((init?.headers as Record<string, string>)["X-Rexnora-Operation-Id"]);
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"registrySteps":[{"id":"start"}],"edges":[]}' }, finish_reason: "stop" }],
        usage: { prompt_tokens: 11, completion_tokens: 9, total_tokens: 20 },
      }), { status: 200, headers: { "x-goog-request-id": "gemini-test-request" } });
    },
  });

  const result = await provider.generateStructured({
    systemPrompt: "Return a workflow plan.",
    prompt: "Start manually.",
    schema: { type: "object" },
  }, context);

  assert.deepEqual(result.output, { registrySteps: [{ id: "start" }], edges: [] });
  assert.equal(result.provider, "gemini");
  assert.equal(result.model, "gemini-test-model");
  assert.equal(result.requestId, "gemini-test-request");
  assert.equal(requestOperationId, context.operationId);
  assert.deepEqual(result.usage, { inputTokens: 11, outputTokens: 9, totalTokens: 20 });
  assert.deepEqual(requestBody?.response_format, { type: "json_object" });
  assert.equal((requestBody?.messages as Array<{ role: string }>)[0].role, "system");
});

test("Gemini records structured-output validation failures without retrying malformed model output", async () => {
  const diagnostics: Array<{ status: number; errorCode?: string }> = [];
  const provider = createGeminiProvider({
    env,
    fetchImpl: fakeFetch({
      choices: [{ message: { content: "not-json" }, finish_reason: "stop" }],
    }),
  });
  await assert.rejects(
    provider.generateStructured(
      { prompt: "Return JSON." },
      {
        ...context,
        onProviderAttempt: (event) => diagnostics.push({ status: event.status, errorCode: event.errorCode }),
      },
    ),
    (error: unknown) => error instanceof AIProviderError && error.code === "AI_INVALID_JSON",
  );
  assert.deepEqual(diagnostics, [{ status: 200, errorCode: "AI_INVALID_JSON" }]);
});

test("Gemini adapter supports tool calls without executing them", async () => {
  const provider = createGeminiProvider({
    env,
    fetchImpl: fakeFetch({
      choices: [{
        message: {
          content: null,
          tool_calls: [{
            id: "call_1",
            type: "function",
            function: { name: "workflow.list", arguments: '{"limit":5}' },
          }],
        },
        finish_reason: "tool_calls",
      }],
      usage: { prompt_tokens: 4, completion_tokens: 3 },
    }),
  });

  const result = await provider.generateWithTools({
    prompt: "List recent workflows.",
    tools: [{ name: "workflow.list", description: "List workflows", parameters: { type: "object" } }],
  }, { ...context, task: "agent_tool_calling" });

  assert.equal(result.output.toolCalls.length, 1);
  assert.equal(result.output.toolCalls[0].name, "workflow.list");
  assert.deepEqual(result.output.toolCalls[0].arguments, { limit: 5 });
});

test("provider HTTP errors are standardized and preserve safe retry metadata", async () => {
  const provider = createGeminiProvider({
    env,
    fetchImpl: fakeFetch({ error: { message: "must not be surfaced" } }, 429, {
      "retry-after": "2",
      "x-request-id": "safe-provider-request",
    }),
  });

  await assert.rejects(
    provider.generateText({ prompt: "Hello" }, { ...context, task: "summarization" }),
    (error: unknown) => error instanceof AIProviderError &&
      error.code === "AI_RATE_LIMITED" && error.status === 429 &&
      error.retryAfterMs === 2_000 && error.providerRequestId === "safe-provider-request",
  );
});

test("Gemini cancellation and missing credentials fail with standard error codes", async () => {
  const missing = createGeminiProvider({ env: { NODE_ENV: "test" }, fetchImpl: fakeFetch({}) });
  await assert.rejects(
    missing.generateText({ prompt: "Hello" }, { ...context, task: "summarization" }),
    (error: unknown) => error instanceof AIProviderError && error.code === "AI_NOT_CONFIGURED",
  );

  const controller = new AbortController();
  controller.abort();
  const provider = createGeminiProvider({ env, fetchImpl: fakeFetch({}) });
  await assert.rejects(
    provider.generateText({ prompt: "Hello" }, { ...context, signal: controller.signal, task: "summarization" }),
    (error: unknown) => error instanceof AIProviderError && error.code === "AI_CANCELLED",
  );
});

test("default routing prefers configured Gemini and retains Groq as an alternate", () => {
  const registry = createDefaultAIProviderRegistry(env);
  const route = routeAIRequest("workflow_generation", registry, env);
  assert.equal(route.provider.id, "gemini");
  assert.equal(route.primaryModel, "gemini-test-model");
  assert.deepEqual(route.fallbackModels, ["gemini-test-fallback"]);
  assert.deepEqual(registry.list().map((provider) => provider.id), ["gemini", "groq"]);
});

test("failover order remains reversible when Groq or Cloudflare is configured as primary", () => {
  const groqEnv = { ...env, GROQ_API_KEY: "test-groq-secret", AI_PRIMARY_PROVIDER: "groq" };
  const groqRegistry = new AIProviderRegistry();
  groqRegistry.register(createGeminiProvider({ env }));
  groqRegistry.register(createGroqProvider({ env: groqEnv }));
  assert.deepEqual(
    routeAIRequests("summarization", groqRegistry, groqEnv).map((route) => route.provider.id),
    ["groq", "gemini"],
  );
});

test("retry delay honors Retry-After as a minimum while preserving jittered backoff", () => {
  const policy = { maxAttempts: 3, maxRateLimitRetries: 1, baseDelayMs: 500, maxInlineWaitMs: 6_000 };
  assert.equal(retryDelayMs(3, 1_750, policy, () => 0), 1_750);
  assert.equal(retryDelayMs(3, 0, policy, () => 0.5), 1_000);
});

test("Groq is available only with a server key while Cloudflare remains explicitly disabled", async () => {
  const groq = createGroqProvider({ env: { NODE_ENV: "test" } });
  const cloudflare = createCloudflareProvider();
  assert.equal(groq.isConfigured(), false);
  assert.equal(groq.capabilities.structuredOutput, true);
  assert.equal(groq.capabilities.toolCalling, true);
  assert.equal(cloudflare.isConfigured(), false);
  assert.equal(cloudflare.capabilities.structuredOutput, false);
  await assert.rejects(
    groq.generateText({ prompt: "No key." }, { ...context, task: "summarization" }),
    (error: unknown) => error instanceof AIProviderError && error.code === "AI_NOT_CONFIGURED",
  );
  await assert.rejects(
    cloudflare.generateText({ prompt: "Not enabled." }, { ...context, task: "summarization" }),
    (error: unknown) => error instanceof AIProviderError && error.code === "AI_PROVIDER_DISABLED",
  );
});

test("gateway uses the same registry and operation context for a successful structured request", async () => {
  const registry = new AIProviderRegistry();
  registry.register(createGeminiProvider({
    env,
    fetchImpl: fakeFetch({
      choices: [{ message: { content: '{"accepted":true}' }, finish_reason: "stop" }],
      usage: { prompt_tokens: 2, completion_tokens: 1 },
    }),
  }));
  const gateway = createAIGateway(registry, env);
  const budget = { remainingProviderAttempts: 3, totalProviderAttempts: 0, deadlineAt: Date.now() + 5_000 };
  const result = await gateway.generateStructured(
    { systemPrompt: "Return a JSON object.", prompt: "Confirm." },
    { ...context, attemptBudget: budget, deadlineAt: budget.deadlineAt },
  );

  assert.deepEqual(result.output, { accepted: true });
  assert.equal(result.provider, "gemini");
  assert.equal(result.fallbackUsed, false);
  assert.equal(budget.remainingProviderAttempts, 2);
  assert.equal(budget.totalProviderAttempts, 1);
});

test("gateway retries transient overloads, then uses the approved Gemini model fallback", async () => {
  const calls: string[] = [];
  const operationIds: string[] = [];
  const attemptEvents: Array<{ model: string; status: number; fallbackUsed: boolean }> = [];
  const registry = new AIProviderRegistry();
  registry.register(createGeminiProvider({
    env: {
      ...env,
      GEMINI_AI_MODEL: "primary-model",
      GEMINI_FALLBACK_MODEL: "fallback-model",
    },
    fetchImpl: async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as { model: string };
      calls.push(request.model);
      operationIds.push(String((init?.headers as Record<string, string>)["X-Rexnora-Operation-Id"]));
      if (request.model === "primary-model") {
        return new Response(JSON.stringify({ error: { status: "UNAVAILABLE" } }), { status: 503 });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"valid":true}' } }],
        usage: { prompt_tokens: 5, completion_tokens: 2 },
      }), { status: 200 });
    },
  }));
  const gateway = createAIGateway(registry, {
    ...env,
    GEMINI_AI_MODEL: "primary-model",
    GEMINI_FALLBACK_MODEL: "fallback-model",
  });
  const budget = { remainingProviderAttempts: 5, totalProviderAttempts: 0, deadlineAt: Date.now() + 15_000 };
  const result = await gateway.generateStructured(
    { prompt: "Return a JSON object." },
    {
      ...context,
      attemptBudget: budget,
      deadlineAt: budget.deadlineAt,
      onProviderAttempt: (event) => attemptEvents.push({
        model: event.model, status: event.status, fallbackUsed: event.fallbackUsed,
      }),
    },
  );

  assert.deepEqual(calls, ["primary-model", "primary-model", "primary-model", "fallback-model"]);
  assert.deepEqual(operationIds, Array(4).fill(context.operationId));
  assert.equal(result.fallbackUsed, true);
  assert.equal(result.model, "fallback-model");
  assert.equal(result.usage.totalTokens, 7);
  assert.equal(budget.totalProviderAttempts, 4);
  assert.equal(budget.remainingProviderAttempts, 1);
  assert.equal(attemptEvents.at(-1)?.fallbackUsed, true);
});

test("gateway never uses the Gemini model fallback after a rate-limit response", async () => {
  const calls: string[] = [];
  const attemptNumbers: number[] = [];
  const registry = new AIProviderRegistry();
  registry.register(createGeminiProvider({
    env: {
      ...env,
      GEMINI_AI_MODEL: "primary-model",
      GEMINI_FALLBACK_MODEL: "fallback-model",
    },
    fetchImpl: async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as { model: string };
      calls.push(request.model);
      return new Response(JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED" } }), {
        status: 429,
        headers: { "Retry-After": "0" },
      });
    },
  }));
  const gateway = createAIGateway(registry, {
    ...env,
    GEMINI_AI_MODEL: "primary-model",
    GEMINI_FALLBACK_MODEL: "fallback-model",
  });
  await assert.rejects(
    gateway.generateText(
      { prompt: "Wait." },
      {
        ...context,
        task: "summarization",
        onProviderAttempt: (event) => attemptNumbers.push(event.attempt),
      },
    ),
    (error: unknown) => error instanceof AIProviderError &&
      error.code === "AI_RATE_LIMITED" && error.providerAttempts === 2,
  );
  assert.deepEqual(calls, ["primary-model", "primary-model"]);
  assert.deepEqual(attemptNumbers, [1, 2]);
});



test("gateway carries per-provider ceilings across generation and later repair calls", async () => {
  let geminiCalls = 0;
  let groqCalls = 0;
  const registry = new AIProviderRegistry();
  registry.register(createGeminiProvider({
    env,
    fetchImpl: async () => {
      geminiCalls += 1;
      return fakeFetch({ choices: [{ message: { content: "Gemini should be skipped." } }] })();
    },
  }));
  registry.register(createGroqProvider({
    env: { NODE_ENV: "test", GROQ_API_KEY: "test-groq-secret" },
    fetchImpl: async () => {
      groqCalls += 1;
      return fakeFetch({ choices: [{ message: { content: "Groq used after Gemini's operation cap." } }] })();
    },
  }));
  const gateway = createAIGateway(registry, { ...env, GROQ_API_KEY: "test-groq-secret" });
  const budget = {
    remainingProviderAttempts: 8,
    totalProviderAttempts: 4,
    maxProviderAttempts: 8,
    maxAttemptsPerProvider: 4,
    providerAttempts: { gemini: 4 },
    deadlineAt: Date.now() + 5_000,
  };
  const result = await gateway.generateText(
    { prompt: "Use the remaining provider." },
    { ...context, task: "summarization", attemptBudget: budget, deadlineAt: budget.deadlineAt },
  );
  assert.equal(result.provider, "groq");
  assert.equal(result.fallbackUsed, true);
  assert.equal(geminiCalls, 0);
  assert.equal(groqCalls, 1);
  assert.equal(budget.totalProviderAttempts, 5);
});

test("gateway does not exceed the operation-wide provider attempt cap", async () => {
  let providerCalls = 0;
  const registry = new AIProviderRegistry();
  registry.register(createGeminiProvider({
    env,
    fetchImpl: async () => {
      providerCalls += 1;
      return fakeFetch({ choices: [{ message: { content: "Must not execute." } }] })();
    },
  }));
  const gateway = createAIGateway(registry, env);
  const budget = {
    remainingProviderAttempts: 8,
    totalProviderAttempts: 8,
    maxProviderAttempts: 8,
    maxAttemptsPerProvider: 4,
    providerAttempts: { gemini: 4 },
    deadlineAt: Date.now() + 5_000,
  };
  await assert.rejects(
    gateway.generateText(
      { prompt: "This exceeds the cap." },
      { ...context, task: "summarization", attemptBudget: budget, deadlineAt: budget.deadlineAt },
    ),
    (error: unknown) => error instanceof AIProviderError && error.code === "AI_ATTEMPT_LIMIT_REACHED",
  );
  assert.equal(providerCalls, 0);
});

test("gateway does not route around invalid requests or safety rejections", async () => {
  for (const failure of [
    { status: 400, payload: { error: { message: "bad request" } }, code: "AI_INVALID_REQUEST" },
    { status: 200, payload: { choices: [{ message: { content: "" }, finish_reason: "content_filter" }] }, code: "AI_SAFETY_REJECTED" },
    { status: 200, payload: { choices: [{ message: { content: "", refusal: "I cannot assist with that request." }, finish_reason: "stop" }] }, code: "AI_SAFETY_REJECTED" },
    { status: 200, payload: { choices: [{ message: { content: "" }, finish_reason: "PROHIBITED_CONTENT" }] }, code: "AI_SAFETY_REJECTED" },
  ]) {
    let groqCalls = 0;
    const registry = new AIProviderRegistry();
    registry.register(createGeminiProvider({ env, fetchImpl: fakeFetch(failure.payload, failure.status) }));
    registry.register(createGroqProvider({
      env: { NODE_ENV: "test", GROQ_API_KEY: "test-groq-secret" },
      fetchImpl: async () => { groqCalls += 1; return fakeFetch({ choices: [{ message: { content: "should not run" } }] })(); },
    }));
    const gateway = createAIGateway(registry, { ...env, GROQ_API_KEY: "test-groq-secret" });
    await assert.rejects(
      gateway.generateText({ prompt: "No bypass." }, { ...context, task: "summarization" }),
      (error: unknown) => error instanceof AIProviderError && error.code === failure.code,
    );
    assert.equal(groqCalls, 0);
  }
});

test("Groq safety refusals remain terminal after failover from Gemini", async () => {
  const registry = new AIProviderRegistry();
  registry.register(createGeminiProvider({
    env,
    fetchImpl: async () => { throw new TypeError("fetch failed"); },
  }));
  registry.register(createGroqProvider({
    env: { NODE_ENV: "test", GROQ_API_KEY: "test-groq-secret" },
    fetchImpl: fakeFetch({
      choices: [{
        message: {
          content: "",
          refusal: "I cannot assist with that request.",
        },
        finish_reason: "stop",
      }],
    }),
  }));
  const gateway = createAIGateway(registry, { ...env, GROQ_API_KEY: "test-groq-secret" });
  await assert.rejects(
    gateway.generateText(
      { prompt: "Do not bypass a provider refusal." },
      { ...context, task: "summarization" },
    ),
    (error: unknown) => error instanceof AIProviderError && error.code === "AI_SAFETY_REJECTED",
  );
});

test("gateway fails over from invalid provider credentials to the configured Groq provider", async () => {
  const attempts: Array<{ provider?: string; status: number; fallbackUsed: boolean }> = [];
  const groqEnv = { NODE_ENV: "test", GROQ_API_KEY: "test-groq-secret", GROQ_AI_MODEL: "openai/gpt-oss-120b" };
  const registry = new AIProviderRegistry();
  registry.register(createGeminiProvider({
    env,
    fetchImpl: fakeFetch({ error: { message: "invalid key" } }, 401),
  }));
  registry.register(createGroqProvider({
    env: groqEnv,
    fetchImpl: fakeFetch({
      choices: [{ message: { content: "Groq answered." }, finish_reason: "stop" }],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    }),
  }));
  const gateway = createAIGateway(registry, { ...env, ...groqEnv });
  const budget = { remainingProviderAttempts: 8, totalProviderAttempts: 0, deadlineAt: Date.now() + 5_000 };
  const result = await gateway.generateText(
    { prompt: "Answer briefly." },
    {
      ...context,
      task: "summarization",
      attemptBudget: budget,
      deadlineAt: budget.deadlineAt,
      onProviderAttempt: (event) => attempts.push({
        provider: event.provider,
        status: event.status,
        fallbackUsed: event.fallbackUsed,
      }),
    },
  );

  assert.equal(result.output, "Groq answered.");
  assert.equal(result.provider, "groq");
  assert.equal(result.fallbackUsed, true);
  assert.equal(budget.totalProviderAttempts, 2);
  assert.deepEqual(attempts.map((event) => event.provider), ["gemini", "groq"]);
  assert.equal(attempts[1].fallbackUsed, true);

  const isolatedRegistry = new AIProviderRegistry();
  isolatedRegistry.register(createGeminiProvider({
    env,
    fetchImpl: fakeFetch({
      choices: [{ message: { content: "Fresh gateway is healthy." }, finish_reason: "stop" }],
    }),
  }));
  const isolatedGateway = createAIGateway(isolatedRegistry, env);
  const isolatedResult = await isolatedGateway.generateText(
    { prompt: "Check an independent gateway." },
    { ...context, task: "summarization" },
  );
  assert.equal(isolatedResult.provider, "gemini");
});

test("network failures switch providers immediately without retrying the unreachable host", async () => {
  let geminiCalls = 0;
  const registry = new AIProviderRegistry();
  registry.register(createGeminiProvider({
    env,
    fetchImpl: async () => {
      geminiCalls += 1;
      throw new TypeError("fetch failed");
    },
  }));
  registry.register(createGroqProvider({
    env: { NODE_ENV: "test", GROQ_API_KEY: "test-groq-secret" },
    fetchImpl: fakeFetch({ choices: [{ message: { content: "Recovered on Groq." }, finish_reason: "stop" }] }),
  }));
  const gateway = createAIGateway(registry, { ...env, GROQ_API_KEY: "test-groq-secret" });
  const budget = { remainingProviderAttempts: 5, totalProviderAttempts: 0, deadlineAt: Date.now() + 5_000 };
  const result = await gateway.generateText(
    { prompt: "Recover." },
    { ...context, task: "summarization", attemptBudget: budget, deadlineAt: budget.deadlineAt },
  );
  assert.equal(result.provider, "groq");
  assert.equal(result.output, "Recovered on Groq.");
  assert.equal(geminiCalls, 1);
  assert.equal(budget.totalProviderAttempts, 2);
});

test("deadline skips an unaffordable Retry-After wait and preserves time for Groq failover", async () => {
  let geminiCalls = 0;
  const registry = new AIProviderRegistry();
  registry.register(createGeminiProvider({
    env,
    fetchImpl: async () => {
      geminiCalls += 1;
      return new Response(JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED" } }), {
        status: 429,
        headers: { "Retry-After": "3" },
      });
    },
  }));
  registry.register(createGroqProvider({
    env: { NODE_ENV: "test", GROQ_API_KEY: "test-groq-secret" },
    fetchImpl: fakeFetch({
      choices: [{ message: { content: "Used remaining deadline for failover." }, finish_reason: "stop" }],
    }),
  }));
  const gateway = createAIGateway(registry, { ...env, GROQ_API_KEY: "test-groq-secret" });
  const deadlineAt = Date.now() + 1_500;
  const budget = {
    remainingProviderAttempts: 4,
    totalProviderAttempts: 0,
    deadlineAt,
  };
  const result = await gateway.generateText(
    { prompt: "Do not sleep through the request deadline." },
    {
      ...context,
      task: "summarization",
      deadlineAt,
      attemptBudget: budget,
    },
  );
  assert.equal(result.provider, "groq");
  assert.equal(result.output, "Used remaining deadline for failover.");
  assert.equal(geminiCalls, 1);
  assert.equal(budget.totalProviderAttempts, 2);
});

test("long Retry-After prevents same-provider model fallback and routes to Groq", async () => {
  let geminiCalls = 0;
  const providerEnv = {
    ...env,
    GEMINI_AI_MODEL: "gemini-primary",
    GEMINI_FALLBACK_MODEL: "gemini-secondary",
  };
  const registry = new AIProviderRegistry();
  registry.register(createGeminiProvider({
    env: providerEnv,
    fetchImpl: async () => {
      geminiCalls += 1;
      return new Response(JSON.stringify({ error: { status: "UNAVAILABLE" } }), {
        status: 503,
        headers: { "Retry-After": "60" },
      });
    },
  }));
  registry.register(createGroqProvider({
    env: { NODE_ENV: "test", GROQ_API_KEY: "test-groq-secret" },
    fetchImpl: fakeFetch({ choices: [{ message: { content: "Switched providers." }, finish_reason: "stop" }] }),
  }));
  const gateway = createAIGateway(registry, {
    ...providerEnv,
    GROQ_API_KEY: "test-groq-secret",
  });
  const result = await gateway.generateText(
    { prompt: "Switch on a long cooldown." },
    { ...context, task: "summarization" },
  );
  assert.equal(result.provider, "groq");
  assert.equal(geminiCalls, 1);
});

test("dashboard components never call AI providers directly or contain server-side AI keys", () => {
  const root = join(process.cwd(), "app", "dashboard");
  const sourceFiles: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if ([".ts", ".tsx", ".js", ".jsx"].some((extension) => entry.name.endsWith(extension))) {
        sourceFiles.push(fullPath);
      }
    }
  };
  visit(root);
  const forbidden = [
    "generativelanguage.googleapis.com",
    "api.groq.com",
    "api.cloudflare.com/client/v4/accounts",
    "GEMINI_API_KEY",
    "GROQ_API_KEY",
    "CLOUDFLARE_API_TOKEN",
    "NEXT_PUBLIC_GEMINI_",
    "NEXT_PUBLIC_GROQ_",
    "NEXT_PUBLIC_CLOUDFLARE_",
  ];
  const violations = sourceFiles.filter((file) => {
    const source = readFileSync(file, "utf8");
    return forbidden.some((value) => source.includes(value));
  });
  assert.deepEqual(violations, []);
});


test("gateway retries provider timeouts within the shared deadline, then fails over to Groq", async () => {
  let geminiCalls = 0;
  let groqCalls = 0;
  const timeoutEnv = {
    NODE_ENV: "test",
    GEMINI_API_KEY: "test-gemini-secret",
    GEMINI_AI_MODEL: "gemini-timeout-primary",
  };
  const groqEnv = { NODE_ENV: "test", GROQ_API_KEY: "test-groq-secret" };
  const registry = new AIProviderRegistry();
  registry.register(createGeminiProvider({
    env: timeoutEnv,
    fetchImpl: async (_input, init) => new Promise<Response>((_resolve, reject) => {
      geminiCalls += 1;
      const signal = init?.signal;
      const rejectAsTimeout = () => {
        const error = new Error("simulated provider timeout");
        error.name = "AbortError";
        reject(error);
      };
      if (!signal) {
        reject(new Error("Expected the gateway to pass an abort signal."));
        return;
      }
      if (signal.aborted) {
        rejectAsTimeout();
        return;
      }
      signal.addEventListener("abort", rejectAsTimeout, { once: true });
    }),
  }));
  registry.register(createGroqProvider({
    env: groqEnv,
    fetchImpl: async () => {
      groqCalls += 1;
      return fakeFetch({
        choices: [{ message: { content: "Recovered after Gemini timed out." }, finish_reason: "stop" }],
      })();
    },
  }));

  const gateway = createAIGateway(registry, { ...timeoutEnv, ...groqEnv });
  const deadlineAt = Date.now() + 5_000;
  const budget = { remainingProviderAttempts: 8, totalProviderAttempts: 0, deadlineAt };
  const result = await gateway.generateText(
    { prompt: "Recover within the operation deadline." },
    {
      ...context,
      task: "summarization",
      timeoutMs: 25,
      deadlineAt,
      attemptBudget: budget,
    },
  );

  assert.equal(result.provider, "groq");
  assert.equal(result.output, "Recovered after Gemini timed out.");
  assert.equal(result.fallbackUsed, true);
  assert.equal(geminiCalls, 4, "three primary attempts plus one bounded same-provider model fallback");
  assert.equal(groqCalls, 1);
  assert.equal(budget.totalProviderAttempts, 5);
  assert.equal(budget.providerAttempts?.gemini, 4);
});

test("provider authentication cooldown excludes Gemini until expiry, then allows recovery", async () => {
  let geminiCalls = 0;
  let groqCalls = 0;
  let rejectGeminiAuth = true;
  const originalNow = Date.now;
  let fakeNow = originalNow();
  Date.now = () => fakeNow;
  try {
    const groqEnv = { NODE_ENV: "test", GROQ_API_KEY: "test-groq-secret" };
    const registry = new AIProviderRegistry();
    registry.register(createGeminiProvider({
      env,
      fetchImpl: async () => {
        geminiCalls += 1;
        if (rejectGeminiAuth) {
          return fakeFetch({ error: { message: "invalid key" } }, 401)();
        }
        return fakeFetch({
          choices: [{ message: { content: "Gemini recovered after cooldown." }, finish_reason: "stop" }],
        })();
      },
    }));
    registry.register(createGroqProvider({
      env: groqEnv,
      fetchImpl: async () => {
        groqCalls += 1;
        return fakeFetch({
          choices: [{ message: { content: "Groq handled the cooldown window." }, finish_reason: "stop" }],
        })();
      },
    }));
    const gateway = createAIGateway(registry, { ...env, ...groqEnv });

    const first = await gateway.generateText(
      { prompt: "Fail over after invalid credentials." },
      { ...context, task: "summarization" },
    );
    assert.equal(first.provider, "groq");

    const duringCooldown = await gateway.generateText(
      { prompt: "Do not call the unhealthy provider again." },
      { ...context, task: "summarization" },
    );
    assert.equal(duringCooldown.provider, "groq");
    assert.equal(geminiCalls, 1);
    assert.equal(groqCalls, 2);

    fakeNow += 5 * 60_000 + 1;
    rejectGeminiAuth = false;
    const recovered = await gateway.generateText(
      { prompt: "Try Gemini after the cooldown expires." },
      { ...context, task: "summarization" },
    );
    assert.equal(recovered.provider, "gemini");
    assert.equal(recovered.output, "Gemini recovered after cooldown.");
    assert.equal(geminiCalls, 2);
  } finally {
    Date.now = originalNow;
  }
});

test("malformed Gemini tool output fails over to Groq without repeating the invalid output", async () => {
  let geminiCalls = 0;
  let groqCalls = 0;
  const groqEnv = { NODE_ENV: "test", GROQ_API_KEY: "test-groq-secret" };
  const registry = new AIProviderRegistry();
  registry.register(createGeminiProvider({
    env,
    fetchImpl: async () => {
      geminiCalls += 1;
      return fakeFetch({
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: "bad-call",
              type: "function",
              function: { name: "workflow.list", arguments: "{" },
            }],
          },
          finish_reason: "tool_calls",
        }],
      })();
    },
  }));
  registry.register(createGroqProvider({
    env: groqEnv,
    fetchImpl: async () => {
      groqCalls += 1;
      return fakeFetch({
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: "good-call",
              type: "function",
              function: { name: "workflow.list", arguments: '{"limit":3}' },
            }],
          },
          finish_reason: "tool_calls",
        }],
      })();
    },
  }));
  const gateway = createAIGateway(registry, { ...env, ...groqEnv });
  const result = await gateway.generateWithTools(
    {
      prompt: "List workflows.",
      tools: [{ name: "workflow.list", description: "List workflows", parameters: { type: "object" } }],
    },
    { ...context, task: "agent_tool_calling" },
  );

  assert.equal(result.provider, "groq");
  assert.equal(result.fallbackUsed, true);
  assert.equal(result.output.toolCalls[0].name, "workflow.list");
  assert.deepEqual(result.output.toolCalls[0].arguments, { limit: 3 });
  assert.equal(geminiCalls, 1);
  assert.equal(groqCalls, 1);
});

test("provider retries and schema repair share one operation budget and one post-validation credit charge", () => {
  const route = readFileSync(join(process.cwd(), "app/api/ai/generate-workflow/route.ts"), "utf8");
  const usageModule = readFileSync(join(process.cwd(), "lib/ai/usage.ts"), "utf8");
  const budget = route.indexOf("const aiAttemptBudget = {");
  const gateway = route.indexOf("const gatewayGenerateStructured = async");
  const generation = route.indexOf("await generateWorkflow(");
  const repair = route.indexOf("await repairRegistryStepInputs(");
  const validation = route.indexOf("validateRegisteredSteps(rebuilt)");
  const metering = route.indexOf('supabase.rpc("consume_ai_generation_usage"');
  assert.ok(budget >= 0 && gateway > budget);
  assert.ok(generation > gateway && repair > generation);
  assert.ok(validation > repair && metering > validation);
  assert.equal((route.match(/consume_ai_generation_usage/g) || []).length, 1);
  assert.match(route.slice(budget, gateway), /remainingProviderAttempts: 8/);
  assert.match(route.slice(gateway, generation), /attemptBudget: aiAttemptBudget/);
  assert.match(route.slice(gateway, generation), /providerUsage\.totalTokens \+= result\.usage\.totalTokens/);
  assert.match(route.slice(metering, metering + 400), /p_idempotency_key: randomUUID\(\)/);
  assert.match(route.slice(generation, metering), /catch \(providerError\)/);
  assert.match(route.slice(generation, metering), /throw providerError/);
  assert.match(route.slice(metering), /Your AI credit was not charged/);
  assert.doesNotMatch(usageModule, /consume_ai_generation_usage/);
  assert.match(usageModule, /Provider token\/cost telemetry only/);
});


test("gateway fails over from malformed Gemini structured JSON to validated Groq output", async () => {
  let geminiCalls = 0;
  let groqCalls = 0;
  const groqEnv = { NODE_ENV: "test", GROQ_API_KEY: "test-groq-secret" };
  const registry = new AIProviderRegistry();
  registry.register(createGeminiProvider({
    env,
    fetchImpl: async () => {
      geminiCalls += 1;
      return fakeFetch({
        choices: [{ message: { content: '{"registrySteps":' }, finish_reason: "stop" }],
      })();
    },
  }));
  registry.register(createGroqProvider({
    env: groqEnv,
    fetchImpl: async () => {
      groqCalls += 1;
      return fakeFetch({
        choices: [{ message: { content: '{"registrySteps":[{"id":"start"}],"edges":[]}', refusal: null }, finish_reason: "stop" }],
        usage: { prompt_tokens: 4, completion_tokens: 5, total_tokens: 9 },
      })();
    },
  }));
  const gateway = createAIGateway(registry, { ...env, ...groqEnv });
  const result = await gateway.generateStructured(
    { prompt: "Return a valid workflow plan." },
    {
      ...context,
      task: "workflow_generation",
      validate: (value) => {
        assert.deepEqual(value, { registrySteps: [{ id: "start" }], edges: [] });
        return value;
      },
    },
  );

  assert.equal(result.provider, "groq");
  assert.equal(result.fallbackUsed, true);
  assert.deepEqual(result.output, { registrySteps: [{ id: "start" }], edges: [] });
  assert.deepEqual(result.usage, { inputTokens: 4, outputTokens: 5, totalTokens: 9 });
  assert.equal(geminiCalls, 1);
  assert.equal(groqCalls, 1);
});
