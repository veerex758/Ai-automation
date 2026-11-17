import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getExecutableNodeCatalog, getPublicNodeCatalog } from "@/nodes/registry";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    return NextResponse.json({
      // Keep provider listings and executable workflow nodes distinct: the
      // first release contains 100 provider entries and 122 native nodes.
      nodes: getPublicNodeCatalog(),
      executableNodes: getExecutableNodeCatalog(),
    }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return NextResponse.json({ error: "Could not load the registered integration catalog." }, { status: 500 });
  }
}
