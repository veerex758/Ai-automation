export type ResendEmailMessage = { from?: string; to: string; subject: string; text: string };
export type ResendSendOptions = { apiKey?: string; from?: string; idempotencyKey?: string; timeoutMs?: number; fetchImpl?: typeof fetch };
export function sendResendEmail(message: ResendEmailMessage, options?: ResendSendOptions): Promise<{ provider: "resend"; messageId: string }>;
export function isResendConfigured(): boolean;
export function validateEmailMessage(message: unknown): void;
export function getAllowedRecipients(value?: string): string[];
export function isLiveEmailRecipientAllowed(recipient: string, allowlist?: string): boolean;
