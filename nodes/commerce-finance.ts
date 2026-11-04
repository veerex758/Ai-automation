import { z } from "zod";
import type { NodeDefinition } from "./types";

const required = (max = 4000) => z.string().trim().min(1).max(max);
function secret(ctx: { credentials: Readonly<Record<string, Readonly<Record<string, string>>>> }, provider: string, field: string) {
  const value = ctx.credentials[provider]?.[field];
  if (!value) throw new Error(provider.toUpperCase() + "_CONNECTION_REQUIRED");
  return value;
}
function ok(status: number, provider: string) {
  if (status < 200 || status >= 300) throw new Error(provider.toUpperCase() + (status === 429 ? "_RATE_LIMITED" : "_REQUEST_FAILED"));
}

export const commerceNodes: NodeDefinition[] = [
  {
    id: "bigcommerce", name: "BigCommerce", icon: "shopping-cart", category: "communication", version: 1,
    auth: { type: "apiKey", credentialKey: "accessToken" }, triggers: [], actions: [{
      id: "create_product", name: "Create product", description: "Creates a product in a BigCommerce store. This is a live catalogue change; use only after explicit workflow approval and confirm store ownership.",
      inputSchema: z.object({ storeHash: required(80), name: required(250), price: z.number().finite().nonnegative(), type: z.enum(["physical", "digital"]).default("physical"), weight: z.number().finite().nonnegative().optional() }).strict(),
      outputSchema: z.object({ productId: z.number().int().positive(), name: z.string() }).strict(),
      async run(ctx, raw) {
        const i = z.object({ storeHash: required(80), name: required(250), price: z.number().finite().nonnegative(), type: z.enum(["physical", "digital"]).default("physical"), weight: z.number().finite().nonnegative().optional() }).strict().parse(raw);
        if (!/^[a-z0-9]+$/i.test(i.storeHash)) throw new Error("BIGCOMMERCE_INVALID_STORE_HASH");
        const r = await ctx.http.request({ url: "https://api.bigcommerce.com/stores/" + i.storeHash + "/v3/catalog/products", method: "POST", headers: { "X-Auth-Token": secret(ctx, "bigcommerce", "accessToken"), "Content-Type": "application/json", Accept: "application/json" }, body: { name: i.name, price: i.price, type: i.type, weight: i.weight ?? 0 }, timeoutMs: 15000, retries: 0 });
        ok(r.status, "bigcommerce");
        const b = r.body as { data?: { id?: number; name?: string } };
        if (!b.data?.id) throw new Error("BIGCOMMERCE_INVALID_RESPONSE");
        return { productId: b.data.id, name: b.data.name ?? i.name };
      },
    }],
  },
  {
    id: "gumroad", name: "Gumroad", icon: "shopping-bag", category: "communication", version: 1,
    auth: { type: "apiKey", credentialKey: "accessToken" }, triggers: [], actions: [{
      id: "verify_sale", name: "Verify sale", description: "Looks up a Gumroad sale by its sale ID. Read-only; does not initiate refunds or payouts.",
      inputSchema: z.object({ saleId: required(200) }).strict(),
      outputSchema: z.object({ saleId: z.string(), email: z.string().email().optional(), refunded: z.boolean().optional() }).strict(),
      async run(ctx, raw) {
        const i = z.object({ saleId: required(200) }).strict().parse(raw);
        const r = await ctx.http.request({ url: "https://api.gumroad.com/v2/sales", method: "POST", headers: { Accept: "application/json" }, body: { access_token: secret(ctx, "gumroad", "accessToken"), sale_id: i.saleId }, timeoutMs: 12000, retries: 0 });
        ok(r.status, "gumroad");
        const b = r.body as { success?: boolean; sale?: { id?: string; email?: string; refunded?: boolean } };
        if (!b.success || !b.sale?.id) throw new Error("GUMROAD_SALE_NOT_FOUND");
        return { saleId: b.sale.id, email: b.sale.email, refunded: b.sale.refunded };
      },
    }],
  },
  {
    id: "wise", name: "Wise", icon: "wallet", category: "data", version: 1,
    auth: { type: "apiKey", credentialKey: "apiToken" }, triggers: [], actions: [{
      id: "list_profiles", name: "List profiles", description: "Reads the connected Wise account's profiles. No transfers, payouts or other money movement are supported by this node.",
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ profiles: z.array(z.object({ id: z.number(), type: z.string().optional() })) }).strict(),
      async run(ctx, raw) {
        z.object({}).strict().parse(raw);
        const r = await ctx.http.request({ url: "https://api.wise.com/v2/profiles", method: "GET", headers: { Authorization: "Bearer " + secret(ctx, "wise", "apiToken"), Accept: "application/json" }, timeoutMs: 12000, retries: 0 });
        ok(r.status, "wise");
        const b = r.body as Array<{ id?: number; type?: string }>;
        if (!Array.isArray(b)) throw new Error("WISE_INVALID_RESPONSE");
        return { profiles: b.filter(x => typeof x.id === "number").map(x => ({ id: x.id as number, type: x.type })) };
      },
    }],
  },
  {
    id: "coinbase", name: "Coinbase", icon: "coins", category: "data", version: 1,
    auth: { type: "apiKey", credentialKey: "apiKey" }, triggers: [], actions: [{
      id: "list_accounts", name: "List accounts", description: "Reads Coinbase account balances using a restricted API key. Trading, withdrawals and transfers are intentionally not included.",
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ accounts: z.array(z.object({ id: z.string(), name: z.string().optional(), currency: z.string().optional() })) }).strict(),
      async run(ctx, raw) {
        z.object({}).strict().parse(raw);
        const r = await ctx.http.request({ url: "https://api.coinbase.com/v2/accounts", method: "GET", headers: { Authorization: "Bearer " + secret(ctx, "coinbase", "apiKey"), Accept: "application/json" }, timeoutMs: 12000, retries: 0 });
        ok(r.status, "coinbase");
        const b = r.body as { data?: Array<{ id?: string; name?: string; currency?: { code?: string } }> };
        if (!Array.isArray(b.data)) throw new Error("COINBASE_INVALID_RESPONSE");
        return { accounts: b.data.filter(x => typeof x.id === "string").map(x => ({ id: x.id as string, name: x.name, currency: x.currency?.code })) };
      },
    }],
  },
  {
    id: "plaid", name: "Plaid", icon: "landmark", category: "data", version: 1,
    auth: { type: "apiKey", credentialKey: "secret" }, triggers: [], actions: [{
      id: "get_accounts", name: "Get linked accounts", description: "Reads account metadata from Plaid for a previously linked Item. Requires client ID, secret and an access token; never expose access tokens to workflow outputs or logs.",
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ accounts: z.array(z.object({ accountId: z.string(), name: z.string().optional(), type: z.string().optional(), subtype: z.string().optional() })) }).strict(),
      async run(ctx, raw) {
        z.object({}).strict().parse(raw);
        const r = await ctx.http.request({ url: "https://production.plaid.com/accounts/get", method: "POST", headers: { "Content-Type": "application/json" }, body: { client_id: secret(ctx, "plaid", "clientId"), secret: secret(ctx, "plaid", "secret"), access_token: secret(ctx, "plaid", "accessToken") }, timeoutMs: 15000, retries: 0 });
        ok(r.status, "plaid");
        const b = r.body as { accounts?: Array<{ account_id?: string; name?: string; type?: string; subtype?: string }> };
        if (!Array.isArray(b.accounts)) throw new Error("PLAID_INVALID_RESPONSE");
        return { accounts: b.accounts.filter(x => typeof x.account_id === "string").map(x => ({ accountId: x.account_id as string, name: x.name, type: x.type, subtype: x.subtype })) };
      },
    }],
  },
];
