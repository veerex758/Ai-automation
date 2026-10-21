import { NextResponse, type NextRequest } from "next/server";
import { getRequestId } from "@/lib/observability/safe-log.cjs";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const requestId = getRequestId(request.headers.get("x-request-id"));
  const response = NextResponse.json(
    { status: "ok", service: "aivanta" },
    { headers: { "Cache-Control": "no-store" } },
  );
  response.headers.set("x-request-id", requestId);
  return response;
}
