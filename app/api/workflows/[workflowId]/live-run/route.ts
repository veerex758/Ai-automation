import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRequestId, logOperationalEvent } from "@/lib/observability/safe-log.cjs";

/**
 * Legacy synchronous live-run endpoint.
 *
 * Provider execution here used deployment-wide credentials and could bypass
 * node-selected workspace connections. Keep the route as a safe compatibility
 * response, but require all live work to use /dispatch and the durable worker.
 */
export async function POST(request: NextRequest, _context: { params: Promise<{ workflowId: string }> }) {
  const requestId = getRequestId(request.headers.get("x-request-id"));
  const jsonResponse = (body: unknown, init?: ResponseInit) => {
    const response = NextResponse.json(body, init);
    response.headers.set("x-request-id", requestId);
    response.headers.set("Cache-Control", "no-store");
    return response;
  };
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    logOperationalEvent({ event: "live_workflow_run", requestId, route: "/api/workflows/live-run", outcome: "rejected", statusCode: 401 }, console.warn);
    return jsonResponse({ error: "Authentication required." }, { status: 401 });
  }
  logOperationalEvent({ event: "live_workflow_run", requestId, route: "/api/workflows/live-run", outcome: "rejected", statusCode: 409, errorCode: "DURABLE_DISPATCH_REQUIRED" }, console.info);
  return jsonResponse({
    error: "Synchronous live execution is disabled. Dispatch this workflow through the durable execution endpoint so every node uses its selected, verified workspace connection.",
    code: "DURABLE_DISPATCH_REQUIRED",
  }, { status: 409 });
}
