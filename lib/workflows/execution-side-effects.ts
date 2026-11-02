const SIDE_EFFECTING_HTTP_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isSideEffectingHttpMethod(method: unknown): boolean {
  return typeof method === "string" && SIDE_EFFECTING_HTTP_METHODS.has(method.toUpperCase());
}
