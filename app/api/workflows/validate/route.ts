import { validateWorkflowDefinition } from "@/lib/workflows/validation";

const MAX_BODY_BYTES = 1_000_000;

export async function POST(request: Request): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return Response.json(
      { error: "Content-Type must be application/json." },
      { status: 415 },
    );
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return Response.json(
      { error: "Request body must be 1 MB or smaller." },
      { status: 413 },
    );
  }

  let input: unknown;
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return Response.json(
        { error: "Request body must be 1 MB or smaller." },
        { status: 413 },
      );
    }
    input = JSON.parse(rawBody) as unknown;
  } catch {
    return Response.json(
      { error: "Request body must contain valid JSON." },
      { status: 400 },
    );
  }

  const result = validateWorkflowDefinition(input);
  return Response.json(result, { status: result.valid ? 200 : 422 });
}
