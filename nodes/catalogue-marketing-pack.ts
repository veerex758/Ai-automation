/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import type { NodeContext, NodeDefinition } from "./types";

type ProviderId = "x_twitter" | "linkedin" | "facebook_pages" | "instagram" | "tiktok" | "mailchimp" | "typeform";
function secret(ctx: NodeContext, provider: ProviderId, field = "accessToken"): string {
  const value = ctx.credentials[provider]?.[field];
  if (typeof value !== "string" || !value.trim()) throw new Error(provider.toUpperCase() + "_CONNECTION_REQUIRED");
  return value.trim();
}
async function call(ctx: NodeContext, provider: ProviderId, args: { url: string; method?: "GET" | "POST"; headers?: Record<string, string>; body?: unknown }): Promise<unknown> {
  const response = await ctx.http.request({ url: args.url, method: args.method ?? "GET", headers: args.headers, ...(args.body === undefined ? {} : { body: args.body }), timeoutMs: 20000, retries: 0 });
  if (response.status < 200 || response.status >= 300) {
    ctx.logger.error("Marketing provider request failed", { provider, status: response.status });
    throw new Error(response.status === 429 ? provider.toUpperCase() + "_RATE_LIMITED" : provider.toUpperCase() + "_REQUEST_FAILED");
  }
  return response.body;
}
function node<I extends z.ZodTypeAny, O extends z.ZodTypeAny>(args: {
  id: ProviderId; name: string; description: string; input: I; output: O; auth?: NodeDefinition["auth"];
  run(ctx: NodeContext, input: z.infer<I>): Promise<unknown>;
}): NodeDefinition {
  return { id: args.id, name: args.name, icon: "megaphone", category: "communication", version: 1,
    auth: args.auth ?? { type: "oauth2", scopes: ["provider.api"], refresh: "manual" }, triggers: [],
    actions: [{ id: "execute", name: args.name + " action", description: args.description, inputSchema: args.input, outputSchema: args.output,
      async run(ctx, raw) { const input = args.input.parse(raw); return args.output.parse(await args.run(ctx, input)); } }] };
}

export const catalogueMarketingNodes: NodeDefinition[] = [
  node({
    id: "x_twitter", name: "X/Twitter", auth: { type: "oauth2", scopes: ["tweet.write", "users.read"], refresh: "manual" },
    description: "Publishes a text post to the connected X account using its OAuth access token.",
    input: z.object({ text: z.string().trim().min(1).max(280) }).strict(),
    output: z.object({ postId: z.string(), text: z.string() }).strict(),
    async run(ctx, input) {
      const body = await call(ctx, "x_twitter", { url: "https://api.x.com/2/tweets", method: "POST", headers: { Authorization: "Bearer " + secret(ctx, "x_twitter"), "Content-Type": "application/json" }, body: { text: input.text } }) as Record<string, any>;
      if (typeof body?.data?.id !== "string") throw new Error("X_TWITTER_INVALID_RESPONSE");
      return { postId: body.data.id, text: typeof body.data.text === "string" ? body.data.text : input.text };
    },
  }),
  node({
    id: "linkedin", name: "LinkedIn", auth: { type: "oauth2", scopes: ["openid", "profile", "email"], refresh: "manual" },
    description: "Reads the connected LinkedIn member profile using the account's OAuth access token; it does not publish or modify profile data.",
    input: z.object({}).strict(),
    output: z.object({ memberId: z.string(), name: z.string().optional(), email: z.string().email().optional() }).strict(),
    async run(ctx) {
      const body = await call(ctx, "linkedin", { url: "https://api.linkedin.com/v2/userinfo", headers: { Authorization: "Bearer " + secret(ctx, "linkedin") } }) as Record<string, unknown>;
      if (typeof body?.sub !== "string") throw new Error("LINKEDIN_INVALID_RESPONSE");
      return { memberId: body.sub, ...(typeof body.name === "string" ? { name: body.name } : {}), ...(typeof body.email === "string" ? { email: body.email } : {}) };
    },
  }),
  node({
    id: "facebook_pages", name: "Facebook Pages", auth: { type: "oauth2", scopes: ["pages_manage_posts", "pages_show_list"], refresh: "manual" },
    description: "Publishes a text post to the specified Facebook Page using a saved page access token.",
    input: z.object({ pageId: z.string().regex(/^\d{5,30}$/), message: z.string().trim().min(1).max(5000) }).strict(),
    output: z.object({ postId: z.string() }).strict(),
    async run(ctx, input) {
      const token = secret(ctx, "facebook_pages", "pageAccessToken");
      const body = await call(ctx, "facebook_pages", { url: "https://graph.facebook.com/v22.0/" + encodeURIComponent(input.pageId) + "/feed", method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: { message: input.message } }) as Record<string, unknown>;
      if (typeof body?.id !== "string") throw new Error("FACEBOOK_PAGES_INVALID_RESPONSE");
      return { postId: body.id };
    },
  }),
  node({
    id: "instagram", name: "Instagram", auth: { type: "oauth2", scopes: ["instagram_basic", "instagram_content_publish"], refresh: "manual" },
    description: "Publishes an image post to the connected Instagram professional account through the two-step Graph API media container flow.",
    input: z.object({ imageUrl: z.string().url(), caption: z.string().max(2200).optional() }).strict(),
    output: z.object({ mediaId: z.string() }).strict(),
    async run(ctx, input) {
      const token = secret(ctx, "instagram", "accessToken"), account = secret(ctx, "instagram", "igUserId");
      const image = new URL(input.imageUrl);
      if (image.protocol !== "https:" || image.username || image.password) throw new Error("INSTAGRAM_IMAGE_URL_INVALID");
      const container = await call(ctx, "instagram", { url: "https://graph.facebook.com/v22.0/" + encodeURIComponent(account) + "/media", method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: { image_url: image.toString(), ...(input.caption ? { caption: input.caption } : {}) } }) as Record<string, unknown>;
      if (typeof container?.id !== "string") throw new Error("INSTAGRAM_CONTAINER_INVALID");
      const published = await call(ctx, "instagram", { url: "https://graph.facebook.com/v22.0/" + encodeURIComponent(account) + "/media_publish", method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: { creation_id: container.id } }) as Record<string, unknown>;
      if (typeof published?.id !== "string") throw new Error("INSTAGRAM_PUBLISH_INVALID");
      return { mediaId: published.id };
    },
  }),
  node({
    id: "tiktok", name: "TikTok", auth: { type: "oauth2", scopes: ["user.info.basic", "video.list"], refresh: "manual" },
    description: "Lists recent TikTok videos for the connected creator account using the read-only video list API.",
    input: z.object({ maxCount: z.number().int().min(1).max(20).default(10) }).strict(),
    output: z.object({ videos: z.array(z.object({ id: z.string(), title: z.string().optional(), createTime: z.number().optional() }).strict()).max(20) }).strict(),
    async run(ctx, input) {
      const body = await call(ctx, "tiktok", { url: "https://open.tiktokapis.com/v2/video/list/?fields=id,title,create_time", method: "POST",
        headers: { Authorization: "Bearer " + secret(ctx, "tiktok"), "Content-Type": "application/json" }, body: { max_count: input.maxCount ?? 10 } }) as Record<string, any>;
      const videos = Array.isArray(body?.data?.videos) ? body.data.videos.flatMap((v: any) => typeof v?.id === "string" ? [{ id: v.id, ...(typeof v.title === "string" ? { title: v.title } : {}), ...(typeof v.create_time === "number" ? { createTime: v.create_time } : {}) }] : []) : [];
      return { videos: videos.slice(0, input.maxCount ?? 10) };
    },
  }),
  node({
    id: "mailchimp", name: "Mailchimp", auth: { type: "apiKey", credentialKey: "apiKey" },
    description: "Adds or updates a Mailchimp audience member using the account API key and its server region.",
    input: z.object({ listId: z.string().trim().min(1).max(100), email: z.string().email(), status: z.enum(["subscribed", "pending"]).default("subscribed"), firstName: z.string().max(100).optional(), lastName: z.string().max(100).optional() }).strict(),
    output: z.object({ memberId: z.string(), email: z.string().email(), status: z.string() }).strict(),
    async run(ctx, input) {
      const key = secret(ctx, "mailchimp", "apiKey");
      const region = key.split("-").pop() ?? "";
      if (!/^us\d{1,2}$/.test(region)) throw new Error("MAILCHIMP_CONNECTION_INVALID");
      const auth = Buffer.from("aivanta:" + key).toString("base64");
      const body = await call(ctx, "mailchimp", { url: "https://" + region + ".api.mailchimp.com/3.0/lists/" + encodeURIComponent(input.listId) + "/members", method: "POST",
        headers: { Authorization: "Basic " + auth, "Content-Type": "application/json" }, body: { email_address: input.email, status: input.status, merge_fields: { ...(input.firstName ? { FNAME: input.firstName } : {}), ...(input.lastName ? { LNAME: input.lastName } : {}) } } }) as Record<string, unknown>;
      if (typeof body?.id !== "string" || typeof body.email_address !== "string" || typeof body.status !== "string") throw new Error("MAILCHIMP_INVALID_RESPONSE");
      return { memberId: body.id, email: body.email_address, status: body.status };
    },
  }),
  node({
    id: "typeform", name: "Typeform", auth: { type: "apiKey", credentialKey: "accessToken" },
    description: "Reads Typeform form metadata and question count using the connected account's read-only API access.",
    input: z.object({ formId: z.string().trim().min(1).max(100) }).strict(),
    output: z.object({ formId: z.string(), title: z.string(), questionCount: z.number().int().nonnegative() }).strict(),
    async run(ctx, input) {
      const body = await call(ctx, "typeform", { url: "https://api.typeform.com/forms/" + encodeURIComponent(input.formId), headers: { Authorization: "Bearer " + secret(ctx, "typeform") } }) as Record<string, unknown>;
      if (typeof body?.id !== "string" || typeof body.title !== "string") throw new Error("TYPEFORM_INVALID_RESPONSE");
      return { formId: body.id, title: body.title, questionCount: Array.isArray(body.fields) ? body.fields.length : 0 };
    },
  }),
];
