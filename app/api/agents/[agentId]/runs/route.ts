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
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid¶»§q«^