import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { generateWorkflow, MAX_PROMPT_LENGTH } from "@/lib/workflows/ai-workflow-generator.cjs";
import { getRequestId, logOperationalEvent } from "@/lib/observability/safe-log.cjs";
import { findOperation, getPublicNodeCatalog } from "@/nodes/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request.headers.get("x-request-id"));
  const startedAt = Date.now();
  const jsonResponse = (body: unknown, init?: ResponseInit) => {
    const response = NextResponse.json(body, init);
    response.headers.set("x-request-id", requestId);
    response.headers.set("Cache-Control", "no-store");
    return response;
  };
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return jsonResponse({ error: "Authentication required." }, { status: 401 });
    }

    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 12000) {
      return jsonResponse({ error: "Request is too large. Shorten your workflow description." }, { status: 413 });
    }

    let body: unknown;
    try { body = await request.json(); } catch {
      return jsonResponse({ error: "Request body must be valid JSON." }, { status: 400 });
    }
    if (!body || typeof body !== "object" || !("prompt" in body) || typeof body.prompt !== "string") {
      return jsonResponse({ error: "Describe the workflow you want to create." }, { status: 400 });
    }
    if (!body.prompt.trim()) return jsonResponse({ error: "Describe the workflow you want to create." }, { status: 400 });
    if (body.prompt.trim().length > MAX_PROMPT_LENGTH) {
      return jsonResponse({ error: `Keep the description to ${MAX_PROMPT_LENGTH} characters or fewer.` }, { status: 400 });
    }

    const { getOrCreateDefaultWorkspace } = await import("@/lib/supabase/workspace");
    const workspace = await getOrCreateDefaultWorkspace(supabase);
    const { data: usage, error: usageError } = await supabase.rpc("consume_ai_generation_usage", { p_workspace_id: workspace.id, p_idempotency_key: randomUUID() });
    if (usageError) return jsonResponse({ error: "Usage metering unavailable. Apply Phase 5 billing migration." }, { status: 503 });
    if (!usage?.allowed) return jsonResponse({ error: "Monthly AI generation limit reached. Upgrade your plan.", entitlement: usage }, { status: 402 });

    const nodeCatalog = getPublicNodeCatalog();
    const result = await generateWorkflow({ prompt: body.prompt, nodeCatalog, mode: "registry" });
    const registrySteps = result.registrySteps;
    if (!Array.isArray(registrySteps) || registrySteps.length < 1 || registrySteps.length > 30) return jsonResponse({ error: "The generated plan did not pass registry validation." }, { status: 422 });
    const seen = new Set<string>();
    for (let index = 0; index < registrySteps.length; index++) {
      const step = registrySteps[index] as { id?: unknown; nodeId?: unknown; operationId?: unknown; kind?: unknown; input?: unknown };
      if (!step || typeof step.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(step.id) || seen.has(step.id) || typeof step.nodeId !== "string" || typeof step.operationId !== "string" || !["trigger", "action"].includes(String(step.kind)) || !step.input || typeof step.input !== "object" || Array.isArray(step.input)) return jsonResponse({ error: "The generated plan contains an invalid step envelope." }, { status: 422 });
      seen.add(step.id);
      if ((index === 0 && step.kind !== "trigger") || (index > 0 && step.kind !== "action")) return jsonResponse({ error: "A plan must start with one trigger followed by actions." }, { status: 422 });
      const operation = findOperation(step.nodeId, step.operationId, step.kind as "trigger" | "action");
      if (!operation || !operation.inputSchema.safeParse(step.input).success) return jsonResponse({ error: "The generated plan contains invalid node input. Try a simpler request." }, { status: 422 });
    }
    const definition = { version: 1, nodes: [{ id: "trigger-1", type: "trigger", title: "Manual start", description: "Registered workflow trigger.", settings: { event: "manual" } }] };
    return jsonResponse({ ...result, definition, registrySteps, missingConnections: [], connectionStatusAvailable: false, readyToTest: false }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "AI_PROVIDER_ERROR";
    const responses: Record<string, { status: number; message: string }> = {
      AI_NOT_CONFIGURED: { status: 503, message: "AI workflow generation is not configured yet. Add the server-side AIVANTA_AI_API_KEY." },
      AI_CONFIGURATION_ERROR: { status: 503, message: "AI provider configuration is invalid." },
      AI_PROMPT_REQUIRED: { status: 400, message: "Describe the workflow you want to create." },
      AI_PROMPT_TOO_LONG: { status: 400, message: `Keep the description to ${MAX_PROMPT_LENGTH} characters or fewer.` },
      AI_TIMEOUT: { status: 504, message: "The AI provider took too long. Please try again." },
      AI_PROVIDER_UNAVAILABLE: { status: 502, message: "The AI provider could not be reached. Please try again." },
      AI_PROVIDER_AUTH_ERROR: { status: 502, message: "The AI provider rejected its server credentials. Check the server configuration." },
      AI_RATE_LIMITED: { status: 429, message: "The AI provider is busy. Wait a moment and try again." },
      AI_PROVIDER_ERROR: { status: 502, message: "The AI provider could not complete this request." },
      AI_INVALID_RESPONSE: { status: 502, message: "The AI provider returned an unreadable response. Please try again." },
      AI_EMPTY_RESPONSE: { status: 502, message: "The AI provider returned no workflow. Please try again." },
      AI_INVALID_JSON: { status: 502, message: "The AI provider returned an invalid workflow format. Please try again." },
      AI_UNSAFE_WORKFLOW: { status: 422, message: "The generated workflow did not pass Aivanta's safety and validation rules. Try describing a simpler workflow." },
    };
    const mapped = responses[code] || { status: 502, message: "Workflow generation failed safely. Please try again." };
    if (mapped.status >= 500) {
      logOperationalEvent({
        event: "workflow_generation", requestId, route: "/api/ai/generate-workflow",
        outcome: "failure", statusCode: mapped.status,
        durationMs: Math.max(0, Date.now() - startedAt),
        errorCode: Object.hasOwn(responses, code) ? code : "AI_PROVIDER_ERROR",
      }, console.error);
    }
    return jsonResponse({ error: mapped.message }, { status: mapped.status });
  }
}
