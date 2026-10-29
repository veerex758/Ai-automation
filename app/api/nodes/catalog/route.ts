import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPublicNodeCatalog } from "@/nodes/registry";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
    }
    return NextResponse.json({ nodes: getPublicNodeCatalog() }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load the node catalog." }, { status: 500, headers: { "Cache-Control": "private, no-store" } });
  }
}
