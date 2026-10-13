/**
 * Resolve a requested redirect to a same-origin path only.
 * @param {string | null} requestedPath
 * @param {string} origin
 * @returns {string}
 */
export function getSafeInternalPath(requestedPath, origin) {
  if (!requestedPath) return "/dashboard";

  try {
    const target = new URL(requestedPath, origin);
    if (target.origin !== origin) return "/dashboard";
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return "/dashboard";
  }
}
