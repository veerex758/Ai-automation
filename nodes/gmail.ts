import { z } from "zod";
import type { NodeDefinition } from "./types";

const listInput = z.object({
  query: z.string().trim().max(500).optional(),
  maxResults: z.number().int().min(1).max(50).default(10),
  pageToken: z.string().max(2048).optional(),
}).strict();
const listOutput = z.object({
  messages: z.array(z.object({ id: z.string(), threadId: z.string().optional() }).strict()).max(50),
  nextPageToken: z.string().optional(),
  resultSizeEstimate: z.number().int().nonnegative().optional(),
}).strict();
const readInput = z.object({
  messageId: z.string().trim().min(1).max(200),
}).strict();
const readOutput = z.object({
  id: z.string(),
  threadId: z.string().optional(),
  snippet: z.string().optional(),
  internalDate: z.string().optional(),
  headers: z.record(z.string(), z.string()),
  textBody: z.string().max(20000),
}).strict();

function extractText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const item = payload as Record<string, unknown>;
  const body = item.body && typeof item.body === "object" ? item.body as Record<string, unknown> : {};
  if (typeof body.data === "string" && (item.mimeType === "text/plain" || !Array.isArray(item.parts))) {
    return Buffer.from(body.data, "base64url").toString("utf8");
  }
  if (Array.isArray(item.parts)) return item.parts.map(extractText).filter(Boolean).join("\n");
  return "";
}

export const gmailNode: NodeDefinition = {
  id: "gmail", name: "Gmail", icon: "mail", category: "communication", version: 1,
  auth: { type: "oauth2", scopes: ["https://www.googleapis.com/auth/gmail.readonly"], refresh: "managed" },
  triggers: [],
  actions: [
    {
      id: "list_messages", name: "List messages",
      description: "Lists Gmail messages using the connected workspace Google account. Read-only; supports Gmail search syntax.",
      inputSchema: listInput, outputSchema: listOutput,
      async run(ctx, rawInput) {
        const input = listInput.parse(rawInput);
        const token = ctx.credentials.gmail?.accessToken;
        if (!token) throw new Error("GMAIL_CONNECTION_REQUIRED");
        const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
        url.searchParams.set("maxResults", String(input.maxResults));
        if (input.query) url.searchParams.set("q", input.query);
        if (input.pageToken) url.searchParams.set("pageToken", input.pageToken);
        const response = await ctx.http.request({ url: url.toString(), method: "GET", headers: { Authorization: "Bearer " + token } });
        if (response.status < 200 || response.status >= 300) throw new Error(response.status === 401 ? "GMAIL_REAUTH_REQUIRED" : "GMAIL_READ_FAILED");
        const body = response.body as Record<string, unknown>;
        return listOutput.parse({
          messages: Array.isArray(body?.messages) ? body.messages : [],
          ...(typeof body?.nextPageToken === "string" ? { nextPageToken: body.nextPageToken } : {}),
          ...(typeof body?.resultSizeEstimate === "number" ? { resultSizeEstimate: body.resultSizeEstimate } : {}),
        });
      },
    },
    {
      id: "read_message", name: "Read message",
      description: "Reads a Gmail message's headers, snippet and text body. Read-only; attachments are not downloaded.",
      inputSchema: readInput, outputSchema: readOutput,
      async run(ctx, rawInput) {
        const input = readInput.parse(rawInput);
        const token = ctx.credentials.gmail?.accessToken;
        if (!token) throw new Error("GMAIL_CONNECTION_REQUIRED");
        const url = "https://gmail.googleapis.com/gmail/v1/users/me/messages/" + encodeURIComponent(input.messageId) + "?format=full";
        const response = await ctx.http.request({ url, method: "GET", headers: { Authorization: "Bearer " + token } });
        if (response.status < 200 || response.status >= 300) throw new Error(response.status === 401 ? "GMAIL_REAUTH_REQUIRED" : "GMAIL_READ_FAILED");
        const body = response.body as Record<string, unknown>;
        const payload = body?.payload && typeof body.payload === "object" ? body.payload as Record<string, unknown> : {};
        const headers: Record<string, string> = {};
        if (Array.isArray(payload.headers)) for (const header of payload.headers) {
          if (header && typeof header === "object" && typeof (header as Record<string, unknown>).name === "string" && typeof (header as Record<string, unknown>).value === "string") {
            headers[(header as Record<string, string>).name] = (header as Record<string, string>).value;
          }
        }
        return readOutput.parse({
          id: body.id, ...(typeof body.threadId === "string" ? { threadId: body.threadId } : {}),
          ...(typeof body.snippet === "string" ? { snippet: body.snippet } : {}),
          ...(typeof body.internalDate === "string" ? { internalDate: body.internalDate } : {}),
          headers, textBody: extractText(payload).slice(0, 20000),
        });
      },
    },
  ],
};
