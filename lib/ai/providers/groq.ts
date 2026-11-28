import { createUnavailableProvider } from "./unavailable";

/**
 * Phase 1 contract placeholder. Groq transport, schema compatibility,
 * tool-call accuracy and rate-limit-header support are implemented and benchmarked in Phase 2/3.
 * This adapter is deliberately unavailable and is not registered as a route candidate yet.
 */
export const createGroqProvider = () => createUnavailableProvider("groq", "Phase 2/3");
