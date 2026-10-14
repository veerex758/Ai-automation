const MAX_BODY_BYTES = 1_000_000;

async function readBoundedBody(request) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function handleWorkflowValidation(request, validateWorkflowDefinition) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\\/json(?:\\s*;|\\s*$)/i.test(contentType)) {
    return Response.json(
      { error: "Content-Type must be application/json." },
      { status: 415, headers: { "Cache-Control": "no-store" } },
    );
  }

  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader !== null) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
      return Response.json(
        { error: "Request body must be 1 MB or smaller." },
        { status: 413, headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  let input;
  try {
    const rawBody = await readBoundedBody(request);
    if (rawBody === null) {
      return Response.json(
        { error: "Request body must be 1 MB or smaller." },
        { status: 413, headers: { "Cache-Control": "no-store" } },
      );
    }
    input = JSON.parse(rawBody);
  } catch {
    return Response.json(
      { error: "Request body must contain valid JSON." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const result = validateWorkflowDefinition(input);
  return Response.json(result, {
    status: result.valid ? 200 : 422,
    headers: { "Cache-Control": "no-store" },
  });
}

module.exports = { handleWorkflowValidation, MAX_BODY_BYTES };
