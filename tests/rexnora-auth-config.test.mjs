import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Preview admin credentials prefer branch-scoped CODED staging keys and preserve production precedence", async () => {
  const source = await read("../lib/supabase/admin.ts");
  assert.match(source, /const isPreview = process\.env\.VERCEL_ENV === "preview"/);
  assert.match(source, /const isRexnoraStagingPreview = isPreview\s*&& process\.env\.VERCEL_GIT_COMMIT_REF === "integration\\/saas-core-stage3-realestate-20261123"/);\n  assert.match(source, /const serviceRoleKey = isRexnoraStagingPreview\s*\? process\.env\.CODED_SUPABASE_SERVICE_ROLE_KEY \\|\\| process\.env\.CODED_SUPABASE_SECRET_KEY\s*: isPreview\s*\? process\.env\.SUPABASE_SECRET_KEY \\|\\| process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(source, /: process\.env\.SUPABASE_SECRET_KEY\s*\|\|\s*process\.env\.SUPABASE_SERVICE_ROLE_KEY\s*\|\|\s*process\.env\.CODED_SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(source, /if \(!url \|\| !serviceRoleKey\) throw new Error/);
  assert.match(source, /import "server-only"/);
});

test("Google OAuth start and connection routes share the server-only admin client resolver", async () => {
  const start = await read("../app/api/integrations/google/start/route.ts");
  const connections = await read("../app/api/integrations/google/connections/route.ts");
  assert.match(start, /import \{ createAdminClient \} from "@\/lib\/supabase\/admin"/);
  assert.match(start, /const admin = createAdminClient\(\)/);
  assert.match(connections, /import \{ createAdminClient \} from "@\/lib\/supabase\/admin"/);
  assert.match(connections, /admin = createAdminClient\(\)/);
  assert.match(connections, /function serviceClient\(\)\s*\{\s*return createAdminClient\(\);\s*\}/);
  assert.doesNotMatch(start, /process\.env\.(?:SUPABASE_SERVICE_ROLE_KEY|CODED_SUPABASE_SERVICE_ROLE_KEY)/);
  assert.doesNotMatch(connections, /process\.env\.(?:SUPABASE_SERVICE_ROLE_KEY|CODED_SUPABASE_SERVICE_ROLE_KEY)/);
});

test("middleware accepts the same public Supabase key aliases as browser and server clients", async () => {
  const middleware = await read("../middleware.ts");
  assert.match(middleware, /NEXT_PUBLIC_SUPABASE_URL\s*\?\?\s*process\.env\.NEXT_PUBLIC_CODED_SUPABASE_URL/);
  assert.match(middleware, /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY[\s\S]*NEXT_PUBLIC_CODED_SUPABASE_PUBLISHABLE_KEY[\s\S]*NEXT_PUBLIC_SUPABASE_ANON_KEY[\s\S]*NEXT_PUBLIC_CODED_SUPABASE_ANON_KEY/);
  assert.match(middleware, /if \(!url \|\| !key\)/);
});

test("login and signup surface safe actionable errors without logging credentials or PII", async () => {
  const page = await read("../app/login/page.tsx");
  assert.match(page, /function safeAuthErrorMessage/);
  for (const code of ["invalid_credentials", "email_not_confirmed", "user_already_exists", "weak_password", "signup_disabled", "over_email_send_rate_limit"]) {
    assert.ok(page.includes(code), `missing safe mapping for ${code}`);
  }
  assert.match(page, /setError\(safeAuthErrorMessage\(caught, mode\)\)/);
  assert.match(page, /console\.warn\("\[auth\] request failed"/);
  assert.doesNotMatch(page, /console\.warn\([^\n]*email/);
  assert.doesNotMatch(page, /console\.warn\([^\n]*password/);
  assert.doesNotMatch(page, /setError\(.*candidate\.message/);
});
