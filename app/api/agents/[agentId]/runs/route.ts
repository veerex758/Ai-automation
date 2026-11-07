import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
type Context = { params: Promise<{ agentId: string }> };

async function auth() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { response: NextResponse.json({ error: "Authentication required." }, { status: 401, headers }) };
  return { supabase, user };
}

export async function GET(_request: NextRequest, context: Context) {
  const a = await auth();
  if ("response" in a) return a.response;
  const { agentId } = await context.params;
  const { data: runs, error } = await a.supabase.from("agent_runs")
    .select("id,status,input,output,model_provider,model_name,error_code,started_at,finished_at,created_at")
    .eq("agent_id", agentId).order("created_at", { ascending: false }).limit(25);
  if (error) return NextResponse.json({ error: "Could not load agent runs." }, { status: 500, headers });
  return NextResponse.json({ runs: runs ?? [] }, { headers });
}

export async function POST(request: NextRequest, context: Context) {
  const a = await auth();
  if ("response" in a) return a.response;
  const { agentId } = await context.params;
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400, headers }); }
  const input = body && typeof body === "object" && "input" in body && typeof body.input === "string" ? body.input.trim() : "";
  if (!input || input.length > 12000) return NextResponse.json({ error: "Input must be 1–12,000 characters." }, { status: 400, headers });

  const { data: agent, error: agentError } = await a.supabase.from("agents")
    .select("id,workspace_id,name,instructions,model_provider,model_name,status,permissions")
    .eq("id", agentId).single();
  if (agentError || !agent) return NextResponse.json({ error: "Agent not found." }, { status: 404, headers });
  if (agent.status !== "ready") return NextResponse.json({ error: "Set this agent to Ready before running it." }, { status: 409, headers });
  if (!agent.instructions?.trim()) return NextResponse.json({ error: "Add agent instructions before running." }, { status: 422, headers });
  // Tool IDs remain descriptive. This endpoint only invokes the configured text model.
  const { data: usage, error: usageError } = await a.supabase.rpc("consume_workspace_usage", { p_workspace_id: agent.workspace_id, p_metric: "agent_run", p_quantity: 1, p_metadata: { agent_id: agent.id } });
  if (usageError) return NextResponse.json({ error: "Usage metering unavailable. Apply Phase 5 billing migration." }, { status: 503, headers });
  if (!usage?.allowed) return NextResponse.json({ error: "Monthly agent run limit reached. Upgrade your plan.", entitlement: usage }, { status: 402, headers });
  const { data: run, error: insertError } = await a.supabase.from("agent_runs").insert({
    workspace_id: agent.workspace_id, agent_id: agent.id, actor_user_id: a.user.id,
    status: "running", input, model_provider: agent.model_provider, model_name: agent.model_name,
  }).select("id").single();
  if (insertError || !run) return NextResponse.json({ error: "Could not create agent run." }, { status: 500, headers });

  let output = "";
  let errorCode = "";
  try {
    const system = agent.instructions.slice(0, 12000) + "\n\nSafety: You are an Aivanta agent. Do not claim to have used tools, accessed external systems, or performed actions. You only generate a response.";
    const timeout = AbortSignal.timeout(30000);
    if (agent.model_provider === "gemini") {
      const key = process.env.GEMINI_API_KEY || process.env.AIVANTA_AI_API_KEY;
      if (!key) throw new Error("AI_NOT_CONFIGURED");
      const model = /^[a-zA-Z0-9._-]{1,120}$/.test(agent.model_name) ? agent.model_name : "gemini-2.5-flash";
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: input }] }], generationConfig: { maxOutputTokens: 1200, temperature: 0.3 } }), signal: timeout,
      });
      if (!response.ok) throw new Error(response.status === 429 ? "AI_RATE_LIMITED" : response.status === 401 || response.status === 403 ? "AI_PROVIDER_AUTH_ERROR" : "AI_PROVIDER_ERROR");
      const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      output = payload.candidates?.[0]?.content?.parts?.map(p => p.text ?? "").join("").trim() ?? "";
    } else {
      const key = process.env.OPENAI_API_KEY || process.env.AIVANTA_AI_API_KEY;
      if (!key) throw new Error("AI_NOT_CONFIGURED");
      const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: agent.model_name, instructions: system, input, max_output_tokens: 1200 }), signal: timeout });
      if (!response.ok) throw new Error(response.status === 429 ? "AI_RATE_LIMITED" : "AI_PROVIDER_ERROR");
      const payload = await response.json() as { output_text?: string };
      output = payload.output_text?.trim() ?? "";
    }
    if (!output) throw new Error("AI_EMPTY_RESPONSE");
    await a.supabase.from("agent_runs").update({ status: "completed", output: output.slice(0, 20000), finished_at: new Date().toISOString() }).eq("id", run.id);
    await a.supabase.from("agent_activity").insert({ workspace_id: agent.workspace_id, agent_id: agent.id, actor_user_id: a.user.id, event_type: "agent.run_completed", details: { run_id: run.id, provider: agent.model_provider } });
    return NextResponse.json({ run: { id: run.id, status: "completed", output } }, { headers });
  } catch (error) {
    errorCode = error instanceof Error && /^[A-Z0-9_]{1,80}$/.test(error.message) ? error.message : "AI_PROVIDER_ERROR";
    await a.supabase.from("agent_runs").update({ status: "failed", error_code: errorCode, finished_at: new Date().toISOString() }).eq("id", run.id);
    await a.supabase.from("agent_activity").insert({ workspace_id: agent.workspace_id, agent_id: agent.id, actor_user_id: a.user.id, event_type: "agent.run_failed", details: { run_id: run.id, error_code: errorCode } });
    const status = errorCode === "AI_NOT_CONFIGURED" ? 503 : errorCode === "AI_RATE_LIMITED" ? 429 : errorCode === "AI_PROVIDER_AUTH_ERROR" ? 502 : 502;
    return NextResponse.json({ error: errorCode === "AI_NOT_CONFIGURED" ? "AI provider is not configured." : errorCode === "AI_RATE_LIMITED" ? "AI provider is busy; retry shortly." : "Agent model run failed. Check provider configuration and try again.", run_id: run.id }, { status, headers });
  }
}
