import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateWorkflow, MAX_PROMPT_LENGTH } from "@/lib/workflows/ai-workflow-generator.cjs";
import { getPublicNodeCatalog } from "@/nodes/registry";

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

    const result = await generateWorkflow({ prompt: body.prompt, nodeCatalog: getPublicNodeCatalog() });
    return NextResponse.json(result);
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
