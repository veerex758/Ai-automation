import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getNodeRegistry } from "@/lib/workflows/node-registry.cjs";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    return NextResponse.json(getNodeRegistry(), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("Failed to load Aivanta node registry:", error);
    return NextResponse.json({ error: "Could not load workflow nodes. Please try again." }, { status: 500 });
  }
}
