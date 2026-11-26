import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { generateWorkflow, MAX_PROMPT_LENGTH } from "@/lib/workflows/ai-workflow-generator.cjs";
import { getRequestId, logOperationalEvent } from "@/lib/observability/safe-log.cjs";
import { findOperation, getExecutableNodeCatalog } from "@/nodes/registry";
import { buildRegistrySteps } from "@/lib/workflows/build-registry-steps";
import { validateRegisteredSteps } from "@/nodes/validate-steps";
import { getUnsupportedRequestedCapabilities } from "@/lib/workflows/ai-request-capability-guard.cjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_REAL_ESTATE_OUTCOME_LENGTH = 240;
const REAL_ESTATE_CRM_PROVIDERS = new Set(["pipedrive", "zoho_crm", "freshsales"]);

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

    const starterType = "starterType" in body ? body.starterType : undefined;
    if (starterType !== undefined && starterType !== "real_estate") {
      return jsonResponse({ error: "The requested workflow starter is not supported." }, { status: 400 });
    }
    const requestedCrmProvider = "crmProvider" in body ? body.crmProvider : "pipedrive";
    if (starterType === "real_estate" &&
        (typeof requestedCrmProvider !== "string" || !REAL_ESTATE_CRM_PROVIDERS.has(requestedCrmProvider))) {
      return jsonResponse({ error: "Choose a supported CRM for the real-estate starter." }, { status: 400 });
    }

    const promptLimit = starterType === "real_estate" ? MAX_REAL_ESTATE_OUTCOME_LENGTH : MAX_PROMPT_LENGTH;
    if (body.prompt.trim().length > promptLimit) {
      const message = starterType === "real_estate"
        ? `Keep the business outcome to ${MAX_REAL_ESTATE_OUTCOME_LENGTH} characters or fewer.`
        : `Keep the description to ${MAX_PROMPT_LENGTH} characters or fewer.`;
      return jsonResponse({ error: message }, { status: 400 });
    }

    const { getOrCreateDefaultWorkspace } = await import("@/lib/supabase/workspace");
    const workspace = await getOrCreateDefaultWorkspace(supabase);

    // Read the current allowance before calling Gemini so an exhausted account
    // does not incur provider cost. The final consume RPC remains after graph
    // validation and is the authoritative atomic charge for concurrent requests.
    const { data: entitlement, error: entitlementError } = await supabase.rpc("get_workspace_entitlements", {
      p_workspace_id: workspace.id,
    });
    if (entitlementError || !entitlement || typeof entitlement !== "object") {
      return jsonResponse({
        error: "Usage limits could not be checked. No Rexnora AI credit was charged.",
        errorCode: "AI_USAGE_METERING_UNAVAILABLE",
      }, { status: 503 });
    }
    const planStatus = String((entitlement as { status?: unknown }).status || "");
    if (!["active", "trialing"].includes(planStatus)) {
      return jsonResponse({
        error: "Your workspace subscription is not active. No Rexnora AI credit was charged.",
        errorCode: "AI_SUBSCRIPTION_INACTIVE",
      }, { status: 402 });
    }
    const entitlementUsage = (entitlement as { usage?: { ai_credit?: unknown }; limits?: { ai_credit?: unknown } }).usage;
    const entitlementLimits = (entitlement as { usage?: { ai_credit?: unknown }; limits?: { ai_credit?: unknown } }).limits;
    const aiCreditsUsed = Number(entitlementUsage?.ai_credit);
    const aiCreditLimit = Number(entitlementLimits?.ai_credit);
    if (!Number.isSafeInteger(aiCreditsUsed) || aiCreditsUsed < 0 ||
        !Number.isSafeInteger(aiCreditLimit) || aiCreditLimit < 1) {
      return jsonResponse({
        error: "Your AI usage allowance could not be verified. No Rexnora AI credit was charged.",
        errorCode: "AI_USAGE_METERING_UNAVAILABLE",
      }, { status: 503 });
    }
    if (aiCreditsUsed >= aiCreditLimit) {
      return jsonResponse({
        error: "Monthly AI generation limit reached. No Rexnora AI credit was charged.",
        errorCode: "AI_CREDIT_LIMIT_REACHED",
      }, { status: 402 });
    }

    const nodeCatalog = getExecutableNodeCatalog();
    const unsupportedCapabilities = getUnsupportedRequestedCapabilities(body.prompt, nodeCatalog);
    if (unsupportedCapabilities.length) {
      return jsonResponse({
        error: unsupportedCapabilities.map((issue) => issue.message).join(" "),
        errorCode: "AI_UNSUPPORTED_CAPABILITY",
        unsupportedCapabilities: unsupportedCapabilities.map((issue) => issue.capability),
      }, { status: 422 });
    }
    const result = await generateWorkflow({
      prompt: body.prompt,
      nodeCatalog,
      mode: "registry",
      starterType: starterType === "real_estate" ? starterType : undefined,
      crmProvider: starterType === "real_estate" ? requestedCrmProvider as string : undefined,
    });
    if (!("registrySteps" in result)) return jsonResponse({ error: "The AI provider did not return a registry-backed workflow plan." }, { status: 422 });
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
    let definition: { version: 1; nodes: Array<Record<string, unknown>>; edges?: Array<{ id: string; source: string; target: string; label: "next" | "true" | "false" }> };
    let executableSteps = registrySteps;
    const rawEdges = (result as { edges?: unknown }).edges;
    if (!Array.isArray(rawEdges)) return jsonResponse({ error: "The generated graph must include an explicit connection list." }, { status: 422 });
    {
      if (!Array.isArray(rawEdges) || rawEdges.length > 90) return jsonResponse({ error: "The generated graph has an invalid edge list." }, { status: 422 });
      const ids = new Set(registrySteps.map((step) => String((step as { id: string }).id)));
      const edgeIds = new Set<string>();
      const edges: Array<{ id: string; source: string; target: string; label: "next" | "true" | "false" }> = [];
      for (const candidate of rawEdges) {
        if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return jsonResponse({ error: "The generated graph contains an invalid connection." }, { status: 422 });
        const edge = candidate as Record<string, unknown>;
        if (typeof edge.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(edge.id) || edgeIds.has(edge.id) ||
            typeof edge.source !== "string" || !ids.has(edge.source) || typeof edge.target !== "string" || !ids.has(edge.target) ||
            edge.source === edge.target || !["next", "true", "false"].includes(String(edge.label))) {
          return jsonResponse({ error: "The generated graph contains an invalid connection." }, { status: 422 });
        }
        if (edge.label !== "next") {
          const source = registrySteps.find((step) => (step as { id: string }).id === edge.source) as { nodeId?: string; operationId?: string } | undefined;
          if (!source || source.nodeId !== "if" || source.operationId !== "evaluate") return jsonResponse({ error: "Only IF nodes can create true/false connections." }, { status: 422 });
        }
        edgeIds.add(edge.id);
        edges.push({ id: edge.id, source: edge.source, target: edge.target, label: edge.label as "next" | "true" | "false" });
      }
      const outgoing = new Map([...ids].map((id) => [id, edges.filter((edge) => edge.source === id)]));
      // Reject malformed topology before it reaches the canvas. Only registered
      // IF operations may branch; regular triggers/actions have one Next edge.
      for (const step of registrySteps as Array<{ id: string; nodeId: string; operationId: string }>) {
        const nodeEdges = outgoing.get(step.id) ?? [];
        const isCondition = step.nodeId === "if" && step.operationId === "evaluate";
        if (!isCondition && (nodeEdges.length > 1 || nodeEdges.some((edge) => edge.label !== "next"))) {
          return jsonResponse({ error: "The generated graph branches from a regular step. Only IF nodes may create True and False paths. Generate the draft again." }, { status: 422 });
        }
        if (isCondition && nodeEdges.length > 0 &&
            (nodeEdges.length !== 2 || nodeEdges.filter((edge) => edge.label === "true").length !== 1 || nodeEdges.filter((edge) => edge.label === "false").length !== 1)) {
          return jsonResponse({ error: "The generated IF node must have exactly one True path and one False path." }, { status: 422 });
        }
      }
      const visited = new Set<string>();
      const queue = [String((registrySteps[0] as { id: string }).id)];
      while (queue.length) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;
        visited.add(current);
        for (const edge of outgoing.get(current) ?? []) queue.push(edge.target);
      }
      if (visited.size !== registrySteps.length) return jsonResponse({ error: "Every generated step must be connected to the workflow trigger." }, { status: 422 });
      for (const step of registrySteps as Array<{ id: string; nodeId: string; operationId: string; kind: "trigger" | "action"; input: Record<string, unknown> }>) {
        if (["if", "switch"].includes(step.nodeId)) {
          const branches = outgoing.get(step.id) ?? [];
          if (branches.length && (!branches.some((edge) => edge.label === "true") || !branches.some((edge) => edge.label === "false"))) {
            return jsonResponse({ error: "Every conditional node with downstream work must include true and false paths." }, { status: 422 });
          }
        }
      }
      const graphDepthById = new Map<string, number>();
      const graphLaneById = new Map<string, number>();
      // Lay the graph out left-to-right. IF true/false edges split into upper
      // and lower lanes; following actions inherit their branch lane.
      const unresolvedGraphSteps = new Set((registrySteps as Array<{ id: string }>).map((step) => step.id));
      // Resolve parents before children so layout is independent of the order
      // in which the model happened to list its registered steps.
      for (let pass = 0; pass < registrySteps.length && unresolvedGraphSteps.size > 0; pass += 1) {
        let resolvedAny = false;
        for (const step of registrySteps as Array<{ id: string }>) {
          if (!unresolvedGraphSteps.has(step.id)) continue;
          const incoming = edges.filter((edge) => edge.target === step.id);
          if (incoming.some((edge) => !graphDepthById.has(edge.source))) continue;
          const depth = incoming.length
            ? Math.max(...incoming.map((edge) => graphDepthById.get(edge.source) ?? 0)) + 1
            : 0;
          const lanes = incoming.map((edge) => {
            const sourceLane = graphLaneById.get(edge.source) ?? 0;
            return sourceLane + (edge.label === "true" ? -1 : edge.label === "false" ? 1 : 0);
          });
          const lane = lanes.length ? lanes.reduce((sum, value) => sum + value, 0) / lanes.length : 0;
          graphDepthById.set(step.id, depth);
          graphLaneById.set(step.id, Math.max(-1, Math.min(1, lane)));
          unresolvedGraphSteps.delete(step.id);
          resolvedAny = true;
        }
        if (!resolvedAny) break;
      }
      const graphNodes = registrySteps.map((raw) => {
        const step = raw as { id: string; nodeId: string; operationId: string; kind: "trigger" | "action"; input: Record<string, unknown> };
        const provider = nodeCatalog.find((item) => item.id === step.nodeId);
        const operation = (step.kind === "trigger" ? provider?.triggers : provider?.actions)?.find((item) => item.id === step.operationId);
        const isCondition = step.nodeId === "if" && step.operationId === "evaluate";
        const conditionOperator = step.input.operator === "exists" ? "is_set" : String(step.input.operator ?? "equals");
        const settings: Record<string, string> = step.kind === "trigger"
          ? { event: step.nodeId === "schedule" ? "schedule" : step.nodeId === "webhooks" ? "webhook" : "manual" }
          : isCondition
            ? { field: String(step.input.value ?? ""), operator: conditionOperator, value: step.input.compareTo === undefined ? "" : String(step.input.compareTo) }
            : { provider: "internal", operation: "create_task" };
        const depth = graphDepthById.get(step.id) ?? 0;
        const lane = graphLaneById.get(step.id) ?? 0;
        return {
          id: step.id,
          type: step.kind === "trigger" ? "trigger" : isCondition ? "condition" : "action",
          title: operation?.name || provider?.name || step.operationId,
          description: operation?.description || provider?.name || "Registered workflow operation.",
          settings,
          registryNodeId: step.nodeId,
          registryOperationId: step.operationId,
          registryInput: step.input,
          position: { x: 160 + depth * 320, y: 330 + lane * 220 },
        };
      });
      definition = { version: 1, nodes: graphNodes, edges };
      let rebuilt: ReturnType<typeof buildRegistrySteps>;
      try {
        rebuilt = buildRegistrySteps({
          nodes: graphNodes.map((node) => ({
            id: String(node.id), type: node.type as "trigger" | "action" | "condition",
            title: String(node.title), settings: node.settings as Record<string, string>,
            registryNodeId: String(node.registryNodeId), registryOperationId: String(node.registryOperationId),
            registryInput: node.registryInput as Record<string, unknown>,
          })),
          edges,
        });
      } catch {
        return jsonResponse({ error: "The generated workflow graph could not be validated. Try describing the branches more clearly." }, { status: 422 });
      }
      const checked = validateRegisteredSteps(rebuilt);
      if (!checked.steps) return jsonResponse({ error: checked.error || "The generated graph did not pass registry validation." }, { status: 422 });
      executableSteps = checked.steps;
    }
    // Only bill a completed, registry-validated generation. Provider errors and
    // malformed graphs return above this point without consuming a customer credit.
    const { data: usage, error: usageError } = await supabase.rpc("consume_ai_generation_usage", {
      p_workspace_id: workspace.id,
      p_idempotency_key: randomUUID(),
    });
    if (usageError) {
      return jsonResponse({ error: "Usage metering is unavailable. Your AI credit was not charged.", errorCode: "AI_USAGE_METERING_UNAVAILABLE" }, { status: 503 });
    }
    if (!usage?.allowed) {
      return jsonResponse({
        error: "Monthly AI generation limit reached. No AI credit was charged for this request.",
        errorCode: "AI_CREDIT_LIMIT_REACHED",
        entitlement: usage,
      }, { status: 402 });
    }

    const { providerModelUsed, providerFallbackUsed, ...publicResult } = result;
    logOperationalEvent({
      event: "workflow_generation", requestId, route: "/api/ai/generate-workflow",
      outcome: "success", statusCode: 200,
      durationMs: Math.max(0, Date.now() - startedAt),
      provider: "gemini", model: providerModelUsed || (process.env.GEMINI_AI_MODEL || "gemini-3.8-flash").trim(),
      fallbackUsed: providerFallbackUsed === true,
    });
    return jsonResponse({ ...publicResult, definition, registrySteps: executableSteps, missingConnections: [], connectionStatusAvailable: false, readyToTest: false }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "AI_PROVIDER_ERROR";
    const responses: Record<string, { status: number; message: string }> = {
      AI_NOT_CONFIGURED: { status: 503, message: "Gemini workflow generation is not configured. Add the server-side GEMINI_API_KEY. No Rexnora AI credit was charged." },
      AI_CONFIGURATION_ERROR: { status: 503, message: "AI provider configuration is invalid. No Rexnora AI credit was charged." },
      AI_PROMPT_REQUIRED: { status: 400, message: "Describe the workflow you want to create." },
      AI_PROMPT_TOO_LONG: { status: 400, message: `Keep the description to ${MAX_PROMPT_LENGTH} characters or fewer.` },
      AI_TIMEOUT: { status: 504, message: "Gemini did not respond within the request time limit. No Rexnora AI credit was charged. Please try again." },
      AI_PROVIDER_UNAVAILABLE: { status: 502, message: "Gemini could not be reached. No Rexnora AI credit was charged. Please try again." },
      AI_PROVIDER_OVERLOADED: { status: 503, message: "Gemini is temporarily overloaded after bounded retries. No Rexnora AI credit was charged. Please try again shortly." },
      AI_PROVIDER_AUTH_ERROR: { status: 502, message: "Gemini rejected its server credentials. This is a server configuration issue; no Rexnora AI credit was charged." },
      AI_RATE_LIMITED: { status: 429, message: "Gemini's rate limit was reached. No Rexnora AI credit was charged. Wait a moment and try again." },
      AI_PROVIDER_ERROR: { status: 502, message: "Gemini could not complete this request. No Rexnora AI credit was charged." },
      AI_INVALID_RESPONSE: { status: 502, message: "Gemini returned an unreadable response. No Rexnora AI credit was charged. Please try again." },
      AI_EMPTY_RESPONSE: { status: 502, message: "Gemini returned no workflow. No Rexnora AI credit was charged. Please try again." },
      AI_INVALID_JSON: { status: 502, message: "Gemini returned an invalid workflow format. No Rexnora AI credit was charged. Please try again." },
      AI_UNSAFE_WORKFLOW: { status: 422, message: "The generated workflow did not pass Aivanta's safety and validation rules. No Rexnora AI credit was charged. Try describing a simpler workflow." },
    };
    const mapped = responses[code] || { status: 502, message: "Workflow generation failed safely. Please try again." };
    if (mapped.status >= 500 || (error && typeof error === "object" && "providerStatus" in error)) {
      logOperationalEvent({
        event: "workflow_generation", requestId, route: "/api/ai/generate-workflow",
        outcome: "failure", statusCode: mapped.status,
        durationMs: Math.max(0, Date.now() - startedAt),
        errorCode: Object.hasOwn(responses, code) ? code : "AI_PROVIDER_ERROR",
        provider: "gemini",
        model: error && typeof error === "object" && "providerModel" in error && typeof (error as { providerModel?: unknown }).providerModel === "string"
          ? (error as { providerModel: string }).providerModel
          : (process.env.GEMINI_AI_MODEL || "gemini-3.8-flash").trim(),
        providerStatus: error && typeof error === "object" && "providerStatus" in error ? Number((error as { providerStatus?: unknown }).providerStatus) : undefined,
        providerReason: error && typeof error === "object" && "providerReason" in error ? (error as { providerReason?: unknown }).providerReason : undefined,
        providerType: error && typeof error === "object" && "providerType" in error ? (error as { providerType?: unknown }).providerType : undefined,
        providerRequestId: error && typeof error === "object" && "providerRequestId" in error ? (error as { providerRequestId?: unknown }).providerRequestId : undefined,
      }, console.error);
    }
    return jsonResponse({
      error: mapped.message,
      errorCode: Object.hasOwn(responses, code) ? code : "AI_PROVIDER_ERROR",
    }, { status: mapped.status });
  }
}
