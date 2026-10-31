import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateWorkflow, MAX_PROMPT_LENGTH } from "@/lib/workflows/ai-workflow-generator.cjs";
import { findOperation, getPublicNodeCatalog } from "@/nodes/registry";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 12000) {
      return NextResponse.json({ error: "Request is too large. Shorten your workflow description." }, { status: 413 });
    }

    let body: unknown;
    try { body = await request.json(); } catch {
      return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
    }
    if (!body || typeof body !== "object" || !("prompt" in body) || typeof body.prompt !== "string") {
      return NextResponse.json({ error: "Describe the workflow you want to create." }, { status: 400 });
    }
    if (!body.prompt.trim()) return NextResponse.json({ error: "Describe the workflow you want to create." }, { status: 400 });
    if (body.prompt.trim().length > MAX_PROMPT_LENGTH) {
      return NextResponse.json({ error: `Keep the description to ${MAX_PROMPT_LENGTH} characters or fewer.` }, { status: 400 });
    }

    const nodeCatalog = getPublicNodeCatalog();
    const result = await generateWorkflow({ prompt: body.prompt, nodeCatalog, mode: "registry" });
    const registrySteps = result.registrySteps;
    if (!Array.isArray(registrySteps) || registrySteps.length < 1 || registrySteps.length > 30) return NextResponse.json({ error: "The generated plan did not pass registry validation." }, { status: 422 });
    for (const step of registrySteps) {
      const operation = findOperation(step.nodeId, step.operationId, step.kind);
      if (!operation || !operation.inputSchema.safeParse(step.input).success) return NextResponse.json({ error: "The generated plan contains an invalid node input or data mapping. Try a simpler request." }, { status: 422 });
    }
    const workspace = await getOrCreateDefaultWorkspace(supabase);
    const providerForNode: Record<string, string> = { openai: "openai", gemini: "gemini", slack: "slack", email: "resend", http: "http", gmail: "gmail", google_sheets: "sheets" };
    const requiredProviders = [...new Set(registrySteps.filter((step) => step.kind === "action" && providerForNode[step.nodeId]).map((step) => providerForNode[step.nodeId]))];
    const workspaceProviders = requiredProviders.filter((provider) => provider !== "gmail" && provider !== "sheets");
    const googleProducts = requiredProviders.filter((provider) => provider === "gmail" || provider === "sheets");
    const labels: Record<string, string> = { openai: "OpenAI", gemini: "Google Gemini", slack: "Slack", resend: "Resend Email", http: "Custom HTTPS API", gmail: "Gmail", sheets: "Google Sheets" };
    let missingConnections: Array<{ provider: string; label: string; reason: string }> = [];
    let connectionStatusAvailable = true;
    if (workspaceProviders.length) {
      const { data: integrations, error: integrationError } = await supabase.from("workspace_integrations").select("provider,status,last_test_status").eq("workspace_id", workspace.id);
      if (integrationError) {
        connectionStatusAvailable = false;
        missingConnections.push(...workspaceProviders.map((provider) => ({ provider, label: labels[provider] ?? provider, reason: "Connection status could not be checked. Confirm the workspace integration schema is available." })));
      } else {
        for (const provider of workspaceProviders) {
          const row = (integrations ?? []).find((item) => item.provider === provider);
          if (!row || row.status !== "connected" || row.last_test_status !== "passed") missingConnections.push({
            provider, label: labels[provider] ?? provider,
            reason: !row ? "Not connected in this workspace." : row.last_test_status === "failed" ? "Connection test failed; reconnect or test again." : "Connection has not passed its test yet.",
          });
        }
      }
    }
    if (googleProducts.length) {
      const { data: googleConnections, error: googleError } = await supabase.from("google_connections").select("product,status,scopes").eq("workspace_id", workspace.id);
      if (googleError) {
        connectionStatusAvailable = false;
        missingConnections.push(...googleProducts.map((provider) => ({ provider, label: labels[provider] ?? provider, reason: "Google OAuth connection status could not be checked." })));
      } else {
        for (const provider of googleProducts) {
          const product = provider === "gmail" ? "gmail" : "sheets";
          const row = (googleConnections ?? []).find((item) => item.product === product && item.status === "connected");
          if (!row) missingConnections.push({ provider, label: labels[provider], reason: "Connect this Google product in the current workspace." });
        }
      }
    }
    const definition = { version: 1, nodes: [{ id: "trigger-1", type: "trigger", title: "Manual start", description: "Registered workflow trigger.", settings: { event: "manual" } }] };
    return NextResponse.json({ ...result, definition, registrySteps, missingConnections, connectionStatusAvailable, readyToTest: missingConnections.length === 0 && connectionStatusAvailable }, { headers: { "Cache-Control": "private, no-store" } });
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
    if (mapped.status >= 500) console.error("Aivanta AI workflow generation failed:", code);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
