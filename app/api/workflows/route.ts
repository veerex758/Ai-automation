import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateDefaultWorkspace } from "@/lib/supabase/workspace";

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

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const workspace = await getOrCreateDefaultWorkspace(supabase, user);
    const { data, error } = await supabase
      .from("workflows")
      .select("id, name, description, status, updated_at")
      .eq("workspace_id", workspace.id)
      .order("updated_at", { ascending: false });

    if (error) throw error;
    return NextResponse.json({
      workspace,
      workflows: (data ?? []).map(presentWorkflow),
    });
  } catch (error) {
    console.error("Failed to load Aivanta workflows:", error);
    return NextResponse.json({ error: "Could not load workflows. Check the Aivanta database configuration and try again." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
    }

    if (!body || typeof body !== "object" || !("name" in body) || typeof body.name !== "string") {
      return NextResponse.json({ error: "A workflow name is required." }, { status: 400 });
    }

    const name = body.name.trim();
    if (name.length < 1 || name.length > 80) {
      return NextResponse.json({ error: "Workflow names must be between 1 and 80 characters." }, { status: 400 });
    }

    const description = "description" in body && typeof body.description === "string"
      ? body.description.trim()
      : "";
    if (description.length > 500) {
      return NextResponse.json({ error: "Workflow descriptions cannot exceed 500 characters." }, { status: 400 });
    }


    const workspace = await getOrCreateDefaultWorkspace(supabase, user);
    const { data, error } = await supabase
      .from("workflows")
      .insert({
        workspace_id: workspace.id,
        name,
        description,
        status: "draft",
        definition: {
          version: 1,
          nodes: [{
            id: "trigger-1",
            type: "trigger",
            title: "When this happens",
            description: "Choose an event that starts your workflow.",
            settings: { event: "manual" },
          }],
        },
        created_by: user.id,
      })
      .select("id, name, description, status, updated_at")
      .single();

    if (error) throw error;
    return NextResponse.json({ workflow: presentWorkflow(data) }, { status: 201 });
  } catch (error) {
    console.error("Failed to create Aivanta workflow:", error);
    return NextResponse.json({ error: "Could not save this workflow. Check the Aivanta database configuration and try again." }, { status: 500 });
  }
}
