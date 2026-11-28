import { createUnavailableProvider } from "./unavailable";

/**
 * Phase 1 contract placeholder. Workers AI is not enabled until the Phase 4
 * compatibility and quality benchmark gates have passed.
 */
export const createCloudflareProvider = () => createUnavailableProvider("cloudflare", "Phase 4");
