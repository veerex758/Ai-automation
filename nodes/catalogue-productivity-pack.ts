import { z } from "zod";
import type { NodeContext, NodeDefinition } from "./types";

type ProviderId = "jira" | "asana" | "trello" | "clickup" | "monday" | "todoist" | "airtable" | "bitbucket" | "netlify";
function secret(ctx: NodeContext, provider: ProviderId, field: string): string {
  const value = ctx.credentials[provider]?.[field];
  if (typeof value !== "string" || !value.trim()) throw new Error(provider.toUpperCase() + "_CONNECTION_REQUIRED");
  return value.trim();
}
async function call(ctx: NodeContext, provider: ProviderId, args: { url: string; method?: "GET" | "POST"; headers?: Record<string, string>; body?: unknown }): Promise<unknown> {
  const response = await ctx.http.request({ url: args.url, method: args.method ?? "GET", headers: args.headers, ...(args.body === undefined ? {} : { body: args.body }), timeoutMs: 15000, retries: 0 });
  if (response.status < 200 || response.status >= 300) {
    ctx.logger.error("Productivity provider request failed", { provider, status: response.status });
    throw new Error(response.status === 429 ? provider.toUpperCase() + "_RATE_LIMITED" : provider.toUpperCase() + "_REQUEST_FAILED");
  }
  return response.body;
}
function node<I extends z.ZodTypeAny, O extends z.ZodTypeAny>(args: {
  id: ProviderId; name: string; description: string; input: I; output: O; auth: NodeDefinition["auth"];
  run(ctx: NodeContext, input: z.infer<I>): Promise<unknown>;
}): NodeDefinition {
  return { id: args.id, name: args.name, icon: "list-checks", category: args.id === "bitbucket" || args.id === "netlify" ? "developer" : "data", version: 1, auth: args.auth, triggers: [],
    actions: [{ id: "execute", name: args.name + " action", description: args.description, inputSchema: args.input, outputSchema: args.output,
      async run(ctx, raw) { const input = args.input.parse(raw); return args.output.parse(await args.run(ctx, input)); } }] };
}

export const catalogueProductivityNodes: NodeDefinition[] = [
  node({
    id: "jira", name: "Jira", auth: { type: "apiKey", credentialKey: "apiToken" },
    description: "Creates a Jira issue in a selected project using a site-scoped API token. The site URL is restricted to an Atlassian Cloud hostname.",
    input: z.object({ projectKey: z.string().regex(/^[A-Z][A-Z0-9_]{1,20}$/), summary: z.string().trim().min(1).max(250), description: z.string().max(10000).optional() }).strict(),
    output: z.object({ issueId: z.string(), issueKey: z.string(), url: z.string().url() }).strict(),
    async run(ctx, input) {
      const site = secret(ctx, "jira", "siteUrl");
      let parsed: URL; try { parsed = new URL(site); } catch { throw new Error("JIRA_CONNECTION_INVALID"); }
      if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".atlassian.net") || parsed.username || parsed.password) throw new Error("JIRA_CONNECTION_INVALID");
      const auth = Buffer.from(secret(ctx, "jira", "email") + ":" + secret(ctx, "jira", "apiToken")).toString("base64");
      const body = await call(ctx, "jira", { url: parsed.origin + "/rest/api/3/issue", method: "POST", headers: { Authorization: "Basic " + auth, Accept: "application/json", "Content-Type": "application/json" },
        body: { fields: { project: { key: input.projectKey }, summary: input.summary, issuetype: { name: "Task" }, ...(input.description ? { description: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: input.description }] }] } } : {}) } } }) as Record<string, unknown>;
      if (typeof body?.id !== "string" || typeof body.key !== "string") throw new Error("JIRA_INVALID_RESPONSE");
      return { issueId: body.id, issueKey: body.key, url: parsed.origin + "/browse/" + body.key };
    },
  }),
  node({
    id: "asana", name: "Asana", auth: { type: "oauth2", scopes: ["default"], refresh: "manual" },
    description: "Creates an Asana task in the specified project using the workspace access token.",
    input: z.object({ projectGid: z.string().regex(/^\d{5,30}$/), name: z.string().trim().min(1).max(500), notes: z.string().max(10000).optional() }).strict(),
    output: z.object({ taskGid: z.string(), name: z.string() }).strict(),
    async run(ctx, input) {
      const body = await call(ctx, "asana", { url: "https://app.asana.com/api/1.0/tasks", method: "POST", headers: { Authorization: "Bearer " + secret(ctx, "asana", "accessToken"), "Content-Type": "application/json" },
        body: { data: { name: input.name, projects: [input.projectGid], ...(input.notes ? { notes: input.notes } : {}) } } }) as Record<string, any>;
      if (typeof body?.data?.gid !== "string") throw new Error("ASANA_INVALID_RESPONSE");
      return { taskGid: body.data.gid, name: typeof body.data.name === "string" ? body.data.name : input.name };
    },
  }),
  node({
    id: "trello", name: "Trello", auth: { type: "apiKey", credentialKey: "token" },
    description: "Creates a Trello card in a specified list using the saved API key and token. Credentials are never returned in outputs.",
    input: z.object({ listId: z.string().trim().min(1).max(100), name: z.string().trim().min(1).max(250), description: z.string().max(10000).optional() }).strict(),
    output: z.object({ cardId: z.string(), url: z.string().url() }).strict(),
    async run(ctx, input) {
      const url = new URL("https://api.trello.com/1/cards");
      url.searchParams.set("idList", input.listId); url.searchParams.set("name", input.name);
      if (input.description) url.searchParams.set("desc", input.description);
      url.searchParams.set("key", secret(ctx, "trello", "apiKey")); url.searchParams.set("token", secret(ctx, "trello", "token"));
      const body = await call(ctx, "trello", { url: url.toString(), method: "POST" }) as Record<string, unknown>;
      if (typeof body?.id !== "string" || typeof body.url !== "string") throw new Error("TRELLO_INVALID_RESPONSE");
      return { cardId: body.id, url: body.url };
    },
  }),
  node({
    id: "clickup", name: "ClickUp", auth: { type: "apiKey", credentialKey: "token" },
    description: "Creates a ClickUp task in the selected list using the saved workspace token.",
    input: z.object({ listId: z.string().trim().min(1).max(100), name: z.string().trim().min(1).max(500), description: z.string().max(10000).optional() }).strict(),
    output: z.object({ taskId: z.string(), url: z.string().url().optional() }).strict(),
    async run(ctx, input) {
      const body = await call(ctx, "clickup", { url: "https://api.clickup.com/api/v2/list/" + encodeURIComponent(input.listId) + "/task", method: "POST",
        headers: { Authorization: secret(ctx, "clickup", "token"), "Content-Type": "application/json" }, body: { name: input.name, ...(input.description ? { description: input.description } : {}) } }) as Record<string, unknown>;
      if (typeof body?.id !== "string") throw new Error("CLICKUP_INVALID_RESPONSE");
      return { taskId: body.id, ...(typeof body.url === "string" ? { url: body.url } : {}) };
    },
  }),
  node({
    id: "monday", name: "Monday.com", auth: { type: "apiKey", credentialKey: "apiToken" },
    description: "Creates a Monday.com board item through the GraphQL API using the saved API token.",
    input: z.object({ boardId: z.string().regex(/^\d{1,30}$/), groupId: z.string().trim().min(1).max(100), name: z.string().trim().min(1).max(250) }).strict(),
    output: z.object({ itemId: z.string(), name: z.string() }).strict(),
    async run(ctx, input) {
      const body = await call(ctx, "monday", { url: "https://api.monday.com/v2", method: "POST",
        headers: { Authorization: secret(ctx, "monday", "apiToken"), "Content-Type": "application/json", "API-Version": "2025-10" },
        body: { query: "mutation ($board: ID!, $group: String!, $name: String!) { create_item(board_id: $board, group_id: $group, item_name: $name) { id name } }",
          variables: { board: input.boardId, group: input.groupId, name: input.name } } }) as Record<string, any>;
      const item = body?.data?.create_item;
      if (typeof item?.id !== "string") throw new Error("MONDAY_INVALID_RESPONSE");
      return { itemId: item.id, name: typeof item.name === "string" ? item.name : input.name };
    },
  }),
  node({
    id: "todoist", name: "Todoist", auth: { type: "oauth2", scopes: ["data:read_write"], refresh: "manual" },
    description: "Creates a Todoist task with a title and optional description using the connected workspace token.",
    input: z.object({ content: z.string().trim().min(1).max(500), description: z.string().max(10000).optional(), projectId: z.string().max(100).optional() }).strict(),
    output: z.object({ taskId: z.string(), url: z.string().url().optional() }).strict(),
    async run(ctx, input) {
      const body = await call(ctx, "todoist", { url: "https://api.todoist.com/rest/v2/tasks", method: "POST", headers: { Authorization: "Bearer " + secret(ctx, "todoist", "accessToken"), "Content-Type": "application/json" },
        body: { content: input.content, ...(input.description ? { description: input.description } : {}), ...(input.projectId ? { project_id: input.projectId } : {}) } }) as Record<string, unknown>;
      if (typeof body?.id !== "string") throw new Error("TODOIST_INVALID_RESPONSE");
      return { taskId: body.id, ...(typeof body.url === "string" ? { url: body.url } : {}) };
    },
  }),
  node({
    id: "airtable", name: "Airtable", auth: { type: "apiKey", credentialKey: "accessToken" },
    description: "Creates one Airtable record in a selected base and table using a scoped personal access token.",
    input: z.object({ baseId: z.string().regex(/^app[A-Za-z0-9]{10,}$/), tableId: z.string().trim().min(1).max(100), fields: z.record(z.string(), z.unknown()) }).strict(),
    output: z.object({ recordId: z.string(), createdTime: z.string().optional() }).strict(),
    async run(ctx, input) {
      const body = await call(ctx, "airtable", { url: "https://api.airtable.com/v0/" + encodeURIComponent(input.baseId) + "/" + encodeURIComponent(input.tableId), method: "POST",
        headers: { Authorization: "Bearer " + secret(ctx, "airtable", "accessToken"), "Content-Type": "application/json" }, body: { fields: input.fields } }) as Record<string, unknown>;
      if (typeof body?.id !== "string") throw new Error("AIRTABLE_INVALID_RESPONSE");
      return { recordId: body.id, ...(typeof body.createdTime === "string" ? { createdTime: body.createdTime } : {}) };
    },
  }),
  node({
    id: "bitbucket", name: "Bitbucket", auth: { type: "oauth2", scopes: ["repository:write"], refresh: "manual" },
    description: "Creates an issue in a Bitbucket repository using the workspace access token.",
    input: z.object({ workspace: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/), repository: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/), title: z.string().trim().min(1).max(250), content: z.string().max(10000).optional() }).strict(),
    output: z.object({ issueId: z.number().int(), url: z.string().url() }).strict(),
    async run(ctx, input) {
      const body = await call(ctx, "bitbucket", { url: "https://api.bitbucket.org/2.0/repositories/" + encodeURIComponent(input.workspace) + "/" + encodeURIComponent(input.repository) + "/issues", method: "POST",
        headers: { Authorization: "Bearer " + secret(ctx, "bitbucket", "accessToken"), "Content-Type": "application/json" },
        body: { title: input.title, ...(input.content ? { content: { raw: input.content } } : {}) } }) as Record<string, any>;
      if (typeof body?.id !== "number" || typeof body?.links?.html?.href !== "string") throw new Error("BITBUCKET_INVALID_RESPONSE");
      return { issueId: body.id, url: body.links.html.href };
    },
  }),
  node({
    id: "netlify", name: "Netlify", auth: { type: "apiKey", credentialKey: "token" },
    description: "Lists a bounded number of Netlify sites visible to the workspace access token; this operation is read-only.",
    input: z.object({ limit: z.number().int().min(1).max(50).default(20) }).strict(),
    output: z.object({ sites: z.array(z.object({ id: z.string(), name: z.string(), url: z.string().url().optional() }).strict()).max(50) }).strict(),
    async run(ctx, input) {
      const body = await call(ctx, "netlify", { url: "https://api.netlify.com/api/v1/sites?per_page=" + (input.limit ?? 20), headers: { Authorization: "Bearer " + secret(ctx, "netlify", "token") } });
      if (!Array.isArray(body)) throw new Error("NETLIFY_INVALID_RESPONSE");
      const sites = body.flatMap((site: any) => typeof site?.id === "string" && typeof site?.name === "string"
        ? [{ id: site.id, name: site.name, ...(typeof site.ssl_url === "string" ? { url: site.ssl_url } : typeof site.url === "string" ? { url: site.url } : {}) }] : []);
      return { sites: sites.slice(0, input.limit ?? 20) };
    },
  }),
];
