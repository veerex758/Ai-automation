/* global module */
/**
 * Server-only Resend adapter. Never return credentials or raw provider errors to callers.
 */
const RESEND_ENDPOINT = "https://api.resend.com/emails";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmailMessage(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    throw new Error("An email message is required.");
  }
  const { from, to, subject, text } = message;
  if (typeof from !== "string" || from.trim().length < 3 || from.length > 200) {
    throw new Error("A valid sender address is required.");
  }
  if (typeof to !== "string" || !EMAIL_PATTERN.test(to) || to.length > 254) {
    throw new Error("A valid recipient email address is required.");
  }
  if (typeof subject !== "string" || !subject.trim() || subject.length > 160) {
    throw new Error("Email subjects must be between 1 and 160 characters.");
  }
  if (typeof text !== "string" || !text.trim() || text.length > 10000) {
    throw new Error("Email text must be between 1 and 10,000 characters.");
  }
}

async function sendResendEmail(message, options = {}) {
  validateEmailMessage(message);
  const apiKey = options.apiKey ?? process.env.RESEND_API_KEY;
  const from = options.from ?? process.env.RESEND_FROM_EMAIL ?? message.from;
  if (!apiKey || !apiKey.trim()) {
    throw new Error("Email integration is not configured. Add RESEND_API_KEY to the server environment.");
  }
  if (!from || !from.trim()) {
    throw new Error("Email integration is not configured. Add RESEND_FROM_EMAIL to the server environment.");
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 8000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": "Aivanta/0.1",
        ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: from.trim(),
        to: [message.to],
        subject: message.subject.trim(),
        text: message.text,
      }),
      signal: controller.signal,
      redirect: "error",
    });
    let payload = {};
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }
    if (!response.ok) {
      const error = new Error(
        response.status === 401 || response.status === 403
          ? "The email provider rejected its server credentials or sender configuration."
          : response.status === 429
            ? "The email provider rate limit was reached. Try again later."
            : "The email provider could not accept this message.",
      );
      error.code = response.status === 429 ? "PROVIDER_RATE_LIMIT" : "PROVIDER_REJECTED";
      throw error;
    }
    if (!payload || typeof payload.id !== "string" || !payload.id) {
      throw new Error("The email provider returned an unexpected response.");
    }
    return { provider: "resend", messageId: payload.id };
  } catch (error) {
    if (error && error.name === "AbortError") {
      const timeoutError = new Error("The email provider request timed out.");
      timeoutError.code = "PROVIDER_TIMEOUT";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function isResendConfigured() {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.RESEND_FROM_EMAIL?.trim());
}

module.exports = { sendResendEmail, isResendConfigured, validateEmailMessage };
