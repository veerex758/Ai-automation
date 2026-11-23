import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const startRoute = readFileSync("app/api/integrations/oauth/[provider]/start/route.ts", "utf8");
const callbackRoute = readFileSync("app/api/integrations/oauth/[provider]/callback/route.ts", "utf8");

test("OAuth initiation requires an authenticated workspace owner or admin", () => {
  assert.match(startRoute, /supabase\.auth\.getUser\(\)/);
  assert.match(startRoute, /from\("workspace_members"\)/);
  assert.match(startRoute, /eq\("workspace_id", workspace\.id\)\.eq\("user_id", user\.id\)/);
  assert.match(startRoute, /!\["owner", "admin"\]\.includes\(membership\.role\)/);
  assert.match(startRoute, /status: 403/);
});

test("OAuth callback rechecks workspace membership before exchanging or storing credentials", () => {
  const membershipCheck = callbackRoute.indexOf('from("workspace_members")');
  const tokenExchange = callbackRoute.indexOf("exchangeProviderOAuthCode");
  const credentialWrite = callbackRoute.indexOf('from("workspace_integrations")');
  assert.ok(membershipCheck >= 0, "callback must query workspace membership");
  assert.ok(tokenExchange > membershipCheck, "membership must be checked before token exchange");
  assert.ok(credentialWrite > membershipCheck, "membership must be checked before credential persistence");
  assert.match(callbackRoute, /!\["owner", "admin"\]\.includes\(membership\.role\)/);
});
