import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Legacy synchronous live-run endpoint.
 *
 * Provider execution here used deployment-wide credentials and could bypass
 * node-selected workspace connections. Keep the route as a safe compatibility
 * response, but require all live work to use /dispatch and the durable worker.
 */
export async function POST(_request: NextRequest, _context: { params: Promise<{ workflowId: string }> }) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return NextResponse.json({ error: "Authentication required." }, {
      status: 401, headers: { "Cache-Control": "no-store" },
    });
  }
  return NextResponse.json({
    error: "Synchronous live execution is disabled. Dispatch this workflow through the durable execution endpoint so every node uses its selected, verified workspace connection.",
    code: "DURABLE_DISPATCH_REQUIRED",
  }, {
    status: 409, headers: { "Cache-Control": "no-store" },
  });
}
