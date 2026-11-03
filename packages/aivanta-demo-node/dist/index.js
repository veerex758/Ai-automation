/**
 * Aivanta demo node package.
 *
 * Deliberately capability-free: no network, filesystem, process, environment,
 * credential, or dynamic-code access. This file is package material only;
 * Aivanta's isolated worker is not yet available, so it is not executable.
 */
export async function execute(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Demo node input must be an object.");
  }

  const message = typeof input.message === "string"
    ? input.message.trim()
    : "";

  return {
    message: message || "Hello from Aivanta.",
    node: "@aivanta/demo-hello",
    version: "1.0.0",
  };
}
