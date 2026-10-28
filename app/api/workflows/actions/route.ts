import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getNodeRegistry } from "@/lib/workflows/node-registry.cjs";
import { getPublicNodeCatalog } from "@/nodes/registry";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    return NextResponse.json({
      ...getNodeRegistry(),
      nodes: getPublicNodeCatalog(),
    }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("Failed to load Aivanta action catalog:", error);
    return NextResponse.json({ error: "Could not load workflow actions. Please try again." }, { status: 500 });
  }
}
