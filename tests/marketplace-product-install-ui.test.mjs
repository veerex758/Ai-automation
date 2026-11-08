import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const page=readFileSync(new URL("../app/marketplace/[slug]/page.tsx",import.meta.url),"utf8");
const button=readFileSync(new URL("../app/marketplace/[slug]/install-button.tsx",import.meta.url),"utf8");
 assert.ok(page.includes('user?(product.pricing_type==="free"'));
test("published product detail exposes install only to authenticated users",()=>{
 assert.ok(page.includes("sb.auth.getUser()"));
 assert.ok(page.includes("user?(product.pricing_type==="free""));\n assert.ok(page.includes("<MarketplaceCheckoutButton"));
 assert.ok(page.includes('<Link href="/login">Sign in to purchase/install'));
});

test("marketplace install UI calls authenticated server endpoint and explains draft-only behavior",()=>{
 assert.ok(button.includes('/api/marketplace/products/\${productId}/install'));
 assert.ok(button.includes('method:"POST"'));
 assert.ok(button.includes("No automation runs during installation"));
 assert.ok(button.includes("Open draft workflow"));
});
