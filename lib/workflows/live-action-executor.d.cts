export interface LiveActionNode {
  type: string;
  title?: string;
  settings: Record<string, string>;
}
export interface LiveActionResult {
  provider: string;
  providerMessageId: string;
  message: string;
}
export function executeLiveAction(
  node: LiveActionNode,
  options: {
    idempotencyKey: string;
    sendEmail: (payload: { to: string; subject: string; text: string }, options: { idempotencyKey: string }) => Promise<{ provider?: string; messageId: string }>;
  }
): Promise<LiveActionResult>;
