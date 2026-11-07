import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const page=readFileSync(new URL("../app/marketplace/[slug]/page.tsx",import.meta.url),"utf8");
const button=readFileSync(new URL("../app/marketplace/[slug]/install-button.tsx",import.meta.url),"utf8");

test("published product detail exposes install only to authenticated users",()=>{
 assert.match(page,/user\?<MarketplaceInstallButton productId=\{product\.id\}\s*:\s*<Link href="\/login">/);
 assert.match(page,/user\?<MarketplaceInstallButton productId=\{product\.id\}\s*:\s*<Link href="\/login">/);
});

test("marketplace install UI calls authenticated server endpoint and explains draft-only behavior",()=>{
 assert.match(button,/\/api\/marketplace\/products\/\$\{productId\}\/install/);
 assert.match(button,/method:"POST"/);
 assert.match(button,/No automation runs during installation/);
 assert.match(button,/Open draft workflow/);
});
