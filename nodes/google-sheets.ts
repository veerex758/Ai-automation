import { z } from "zod";
import type { NodeDefinition } from "./types";

const inputSchema = z.object({
  spreadsheetId: z.string().trim().min(10).max(200).regex(/^[a-zA-Z0-9_-]+$/),
  range: z.string().trim().min(1).max(300),
  valueRenderOption: z.enum(["FORMATTED_VALUE", "UNFORMATTED_VALUE", "FORMULA"]).default("FORMATTED_VALUE"),
}).strict();
const outputSchema = z.object({
  range: z.string().optional(),
  majorDimension: z.enum(["ROWS", "COLUMNS"]).optional(),
  values: z.array(z.array(z.unknown()).max(1000)).max(1000),
}).strict();

export const googleSheetsNode: NodeDefinition = {
  id: "google_sheets", name: "Google Sheets", icon: "table", category: "data", version: 1,
  auth: { type: "oauth2", scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"], refresh: "managed" },
  triggers: [],
  actions: [{
    id: "read_range", name: "Read range",
    description: "Reads a cell range from a connected Google spreadsheet. Read-only; does not modify cells.",
    inputSchema, outputSchema,
    async run(ctx, rawInput) {
      const input = inputSchema.parse(rawInput);
      const token = ctx.credentials.sheets?.accessToken;
      if (!token) throw new Error("SHEETS_CONNECTION_REQUIRED");
      const url = new URL("https://sheets.googleapis.com/v4/spreadsheets/" + encodeURIComponent(input.spreadsheetId) + "/values/" + encodeURIComponent(input.range));
      url.searchParams.set("valueRenderOption", input.valueRenderOption);
      const response = await ctx.http.request({ url: url.toString(), method: "GET", headers: { Authorization: "Bearer " + token } });
      if (response.status < 200 || response.status >= 300) throw new Error(response.status === 401 ? "SHEETS_REAUTH_REQUIRED" : "SHEETS_READ_FAILED");
      const body = response.body as Record<string, unknown>;
      return outputSchema.parse({
        ...(typeof body?.range === "string" ? { range: body.range } : {}),
        ...(body?.majorDimension === "ROWS" || body?.majorDimension === "COLUMNS" ? { majorDimension: body.majorDimension } : {}),
        values: Array.isArray(body?.values) ? body.values : [],
      });
    },
  }],
};
