/**
 * Resolve a user-requested internal redirect without permitting protocol-relative,
 * backslash-normalized, control-character, or cross-origin destinations.
 *
 * `origin` must be the current request/browser origin.
 */
export function safeInternalPath(candidate: string | null | undefined, origin: string): string {
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) {
    return "/dashboard";
  }

  // WHATWG URL parsers normalize backslashes in special-scheme URLs; reject them
  // before parsing so inputs such as /\\\\attacker.example cannot become external.
  if (candidate.includes("\\\\") || /%5c/i.test(candidate) || /[\u0000-\u001f\u007f]/.test(candidate)) {
    return "/dashboard";
  }

  try {
    const base = new URL(origin);
    const target = new URL(candidate, base);
    if (target.origin !== base.origin || (target.protocol !== "http:" && target.protocol !== "https:")) {
      return "/dashboard";
    }
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return "/dashboard";
  }
}
