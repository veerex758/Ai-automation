/* global module */
/**
 * Executes one explicitly supported live action.
 * Keep provider-specific behavior behind this boundary so new connectors can be
 * added without allowing the workflow runner to make arbitrary network calls.
 */
async function executeLiveAction(node, options) {
  if (!node || node.type !== "action" || !node.settings || typeof node.settings !== "object") {
    throw new Error("LIVE_ACTION_INVALID");
  }
  const { provider, operation } = node.settings;
  if (provider !== "email" || operation !== "send_email") {
    throw new Error("LIVE_ACTION_UNSUPPORTED");
  }
  if (typeof options?.sendEmail !== "function") {
    throw new Error("LIVE_ACTION_ADAPTER_MISSING");
  }
  const recipient = node.settings.recipient;
  const message = node.settings.message;
  if (typeof recipient !== "string" || !recipient.trim() ||
      typeof message !== "string" || !message.trim()) {
    throw new Error("LIVE_ACTION_CONFIGURATION_INVALID");
  }
  if (typeof options.idempotencyKey !== "string" || !options.idempotencyKey) {
    throw new Error("LIVE_ACTION_IDEMPOTENCY_REQUIRED");
  }

  const result = await options.sendEmail({
    to: recipient,
    subject: typeof node.title === "string" && node.title.trim() ? node.title.trim() : "Aivanta workflow",
    text: message,
  }, { idempotencyKey: options.idempotencyKey });

  if (!result || typeof result.messageId !== "string" || !result.messageId) {
    throw new Error("LIVE_ACTION_PROVIDER_RESULT_INVALID");
  }
  return {
    provider: typeof result.provider === "string" ? result.provider : "email",
    providerMessageId: result.messageId,
    message: "Email accepted by provider.",
  };
}

module.exports = { executeLiveAction };
