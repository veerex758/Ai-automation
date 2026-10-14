import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("protected dashboard treats Supabase session lookup errors as signed out", () => {
  const middleware = source("../middleware.ts");
  assert.match(middleware, /supabase\.auth\.getUser\(\)/);
  assert.match(middleware, /if \(!error\) user = data\.user/);
  assert.match(middleware, /catch \{\s*user = null;\s*\}/);
  assert.match(middleware, /if \(isWorkspace && !user\)/);
});

test("auth callback validates redirect destinations through the shared same-origin helper", () => {
  const callback = source("../app/auth/callback/route.ts");
  const helper = source("../lib/auth/safe-internal-path.ts");
  assert.match(callback, /safeInternalPath\(requestUrl\.searchParams\.get\("next"\), requestUrl\.origin\)/);
  assert.match(helper, /target\.origin !== base\.origin/);
  assert.match(helper, /candidate\.startsWith\("\/\/"\)/);
  assert.match(helper, /%5c/i);
  assert.match(helper, /\[\\u0000-\\u001f\\u007f\]/);
});

test("login UI does not surface raw Supabase authentication error messages", () => {
  const login = source("../app/login/page.tsx");
  assert.match(login, /safeInternalPath\(params\.get\("next"\), window\.location\.origin\)/);
  assert.match(login, /We couldn’t complete sign-in\. Check your details and try again\./);
  assert.doesNotMatch(login, /caught instanceof Error \? caught\.message/);
});

test("login and dashboard responses are marked private and non-cacheable", () => {
  const middleware = source("../middleware.ts");
  assert.match(middleware, /response\.headers\.set\("Cache-Control", "private, no-store"\)/);
});
