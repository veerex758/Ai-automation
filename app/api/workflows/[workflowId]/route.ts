import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

const allowedStatuses = new Set(["draft", "active", "paused", "archived"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function formatUpdatedAt(value: string): string {
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (elapsedSeconds < 60) return "Just now";
  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(value).toLocaleDateString();
}

function presentWorkflow(row: {
  id: string;
  name: string;
  description: string;
  status: string;
  updated_at: string;
}) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: "Uncategorized",
    status: row.status.charAt(0).toUpperCase() + row.status.slice(1),
    runs: "—",
    updated: formatUpdatedAt(row.updated_at),
    icon: "✳",
    tone: "lime",
  };
}

async function getAuthenticatedClient() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { response: NextResponse.json({ error: "Authentication required." }, { status: 401 }) };
  return { supabase, user };
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ workflowId: string }> }) {
  try {
    const { workflowId } = await context.params;
    if (!uuidPattern.test(workflowId)) {
      return NextResponse.json({ error: "Invalid workflow ID." }, { status: 400 });
    }

    const auth = await getAuthenticatedClient();
    if ("response" in auth) return auth.response;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
    }

    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "A workflow update is required." }, { status: 400 });
    }

    const updates: { name?: string; description?: string; status?: string } = {};
    if ("name" in body) {
      if (typeof body.name !== "string" || body.name.trim().length < 1 || body.name.trim().length > 80) {
        return NextResponse.json({ error: "Workflow names must be between 1 and 80 characters." }, { status: 400 });
      }
      updates.name = body.name.trim();
    }
    if ("description" in body) {
      if (typeof body.description !== "string" || body.description.trim().length > 500) {
        return NextResponse.json({ error: "Descriptions cannot exceed 500 characters." }, { status: 400 });
      }
      updates.description = body.description.trim();
    }
    if ("status" in body) {
      if (typeof body.status !== "string" || !allowedStatuses.has(body.status)) {
        return NextResponse.json({ error: "Choose a valid workflow status." }, { status: 400 });
      }
      updates.status = body.status;
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Provide a name, description, or status to update." }, { status: 400 });
    }

    if (updates.status === "active") {
      const { data: candidate, error: candidateError } = await auth.supabase
        .from("workflows").select("id,version,definition").eq("id", workflowId).maybeSingle();
      if (candidateError) throw candidateError;
      if (!candidate) return NextResponse.json({ error: "Workflow not found or you do not have access to it." }, { status: 404 });
      const definition = candidate.definition as { format?: unknown; steps?: unknown } | null;
      if (!definition || definition.format !== "aivanta-registry-v1" || !Array.isArray(definition.steps) || definition.steps.length !== 3) {
        return NextResponse.json({ error: "Activation requires a saved three-step registered workflow: trigger, Gemini qualification, and Resend notification." }, { status: 422 });
      }
      const steps = definition.steps as Array<{ id?: string; nodeId?: string; operationId?: string; kind?: string; input?: unknown }>;
      const supported = steps[0]?.kind === "trigger" &&
        ((steps[0]?.nodeId === "webhooks" && steps[0]?.operationId === "receive_event") || (steps[0]?.nodeId === "manual" && steps[0]?.operationId === "start")) &&
        steps[1]?.kind === "action" && steps[1]?.nodeId === "gemini" && steps[1]?.operationId === "qualify_real_estate_lead" &&
        steps[2]?.kind === "action" && steps[2]?.nodeId === "email" && steps[2]?.operationId === "send_email";
      if (!supported) return NextResponse.json({ error: "Activation currently supports only a trigger → Gemini qualification → Resend notification flow." }, { status: 422 });
      if (!process.env.GEMINI_API_KEY || !process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL || process.env.AIVANTA_LIVE_EXECUTION_ENABLED !== "true") {
        return NextResponse.json({ error: "Configure Gemini, Resend, and the server live-execution switch before activation." }, { status: 503 });
      }
      if (steps[0].nodeId === "webhooks" && (!process.env.AIVANTA_WEBHOOK_ENCRYPTION_KEY ||
          !process.env.AIVANTA_WEBHOOK_SECRET_KEY_VERSION ||
          !(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.CODED_SUPABASE_SERVICE_ROLE_KEY) ||
          !(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.CODED_SUPABASE_URL))) {
        return NextResponse.json({ error: "Secure webhook provisioning is not configured. The workflow was not activated." }, { status: 503 });
      }
      const emailInput = steps[2].input as Record<string, unknown> | undefined;
      const recipient = typeof emailInput?.to === "string" ? emailInput.to.trim().toLowerCase() : "";
      const allowed = new Set((process.env.AIVANTA_LIVE_EMAIL_RECIPIENTS ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean));
      if (!recipient || recipient.includes("{{") || !allowed.has(recipient)) {
        return NextResponse.json({ error: "Set a business-owned notification address and add it to the server email allowlist before activation." }, { status: 403 });
      }
      const { data: tested, error: testError } = await auth.supabase.from("workflow_runs").select("id")
        .eq("workflow_id", workflowId).eq("workflow_version", candidate.version)
        .eq("mode", "dry_run").eq("status", "succeeded").limit(1);
      if (testError) throw testError;
      if (!tested?.length) return NextResponse.json({ error: "Run a successful dry-run of this exact workflow version before activating it." }, { status: 409 });
    }

    const { data, error } = await auth.supabase
      .from("workflows")
      .update(updates)
      .eq("id", workflowId)
      .select("id, name, description, status, updated_at")
      .maybeSingle();

    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Workflow not found or you do not have access to it." }, { status: 404 });
    return NextResponse.json({ workflow: presentWorkflow(data) });
  } catch (error) {
    console.error("Failed to update Aivanta workflow:", error);
    return NextResponse.json({ error: "Could not update this workflow. Try again." }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ workflowId: string }> }) {
  try {
    const { workflowId } = await context.params;
    if (!uuidPattern.test(workflowId)) {
      return NextResponse.json({ error: "Invalid workflow ID." }, { status: 400 });
    }

    const auth = await getAuthenticatedClient();
    if ("response" in auth) return auth.response;

    const { data, error } = await auth.supabase
      .from("workflows")
      .delete()
      .eq("id", workflowId)
      .select("id")
      .maybeSingle();

    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Workflow not found or you do not have access to it." }, { status: 404 });
    return NextResponse.json({ success: true, id: data.id });
  } catch (error) {
    console.error("Failed to delete Aivanta workflow:", error);
    return NextResponse.json({ error: "Could not delete this workflow. Try again." }, { status: 500 });
  }
}
