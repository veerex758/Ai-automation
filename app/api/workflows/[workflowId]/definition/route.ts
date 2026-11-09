import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validateDefinition } from "@/lib/workflows/validate-definition.cjs";
import { validateRegisteredSteps } from "@/nodes/validate-steps";
import type { RegisteredWorkflowStep } from "@/nodes/workflow-runner";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ workflowId: string }> },
) {
  try {
    const { workflowId } = await context.params;
    if (!uuidPattern.test(workflowId))
      return NextResponse.json(
        { error: "Invalid workflow ID." },
        { status: 400 },
      );

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user)
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      );

    const { data: workflow, error: workflowError } = await supabase
      .from("workflows")
      .select("id")
      .eq("id", workflowId)
      .maybeSingle();
    if (workflowError) throw workflowError;
    if (!workflow)
      return NextResponse.json(
        { error: "Workflow not found or you do not have access to it." },
        { status: 404 },
      );

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextRe¶»§q«^