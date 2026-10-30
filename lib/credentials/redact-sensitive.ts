const SENSITIVE_KEY = /(?:authorization|cookie|set-cookie|api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|credential|private[_-]?key|webhook[_-]?url|headers?)/i;

function redactText(value: string, knownSecrets: readonly string[]): string {
  let safe = value.replace(/(Bearer\\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[REDACTED]")
    .replace(/(Basic\\s+)[A-Za-z0-9+/]+=*/gi, "$1[REDACTED]");
  for (const secret of knownSecrets) {
    if (secret.length >= 4) safe = safe.split(secret).join("[REDACTED]");
  }
  return safe;
}

/** Redacts sensitive object fields, auth headers, and known credential values before persistence. */
export function redactSensitiveData(value: unknown, knownSecrets: readonly string[] = [], depth = 0): unknown {
  if (depth > 12) return "[TRUNCATED]";
  if (typeof value === "string") return redactText(value, knownSecrets);
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => redactSensitiveData(item, knownSecrets, depth + 1));
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 200)) {
    output[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactSensitiveData(item, knownSecrets, depth + 1);
  }
  return output;
}
