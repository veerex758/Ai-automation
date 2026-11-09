import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const migration=readFileSync(new URL("../supabase/migrations/20261108110000_aivanta_marketplace_developer_api_keys.sql",import.meta.url),"utf8");
const route=readFileSync(new URL("../app/api/marketplace/developer-keys/route.ts",import.meta.url),"utf8");
const revoke=readFileSync(new URL("../app/api/marketplace/developer-keys/[keyId]/route.ts",import.meta.url),"utf8");
test("developer API keys are private, service-role managed, scoped and hashed",()=>{
 assert.match(migration,/enable row level security/i);
 assert.match(migration,/revoke all .* from anon,authenticated/i);
 assert.match(migration,/key_hash text not null unique/);
 assert.match(migration,/scopes <@ array\['marketplace:read','marketplace:publish'\]/);
 assert.match(route,/createHash\("sha256"\)/);
 assert.match(route,/randomBytes\(32\)/);
 assert.match(route,/secret,data|secret/);
 assert.match(route,/warning:"Copy this secret now/);
 assert.doesNotMatch(route,/select\([^)]*key_hash/);
});
test("developer key APIs authenticate, bound input and restrict revoke to owner",()=>{
 assert.match(route,/getUser\(\)/);
 assert.match(route,/TextEncoder\(\)\.encode\(raw\)\.byteLength>2048/);
 assert.match(route,/expiresInDays/);
 assert.match(revoke,/eq\("owner_user_id",user\.id\)/);
 assert.match(revoke,/is\("revoked_at",null\)/);
});

test("developer API access and lifecycle events are audited without storing key secrets",()=>{
 const audit=readFileSync(new URL("../supabase/migrations/20261108174000_aivanta_marketplace_api_key_audit.sql",import.meta.url),"utf8");
 const publish=readFileSync(new URL("../app/api/v1/marketplace/products/route.ts",import.meta.url),"utf8");
 assert.match(audit,/marketplace_api_key_audit/);assert.match(audit,/enable row level security/i);assert.match(audit,/revoke all .* from anon,authenticated/i);assert.match(audit,/api_key_audit_service_role_required/);
 assert.match(publish,/marketplace_audit_api_key_event/);assert.match(publish,/scope_denied/);assert.match(publish,/rate_limited/);assert.match(route,/marketplace_audit_api_key_event/);assert.match(revoke,/marketplace_audit_api_key_event/);
 assert.doesNotMatch(audit,/secret|token|key_hash/i);
});
