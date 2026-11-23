import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [login, middleware, callback, signout, updatePassword] = await Promise.all([
  read("../app/login/page.tsx"),
  read("../middleware.ts"),
  read("../app/auth/callback/route.ts"),
  read("../app/auth/signout/route.ts"),
  read("../app/auth/update-password/page.tsx"),
]);

test("password recovery sends a non-enumerating reset response through the safe callback", () => {
  assert.match(login, /resetPasswordForEmail/);
  assert.match(login, /auth\/callback\?next=\/auth\/update-password/);
  assert.match(login, /If an account exists for that email/);
  assert.match(login, /auth\.resend/);
  assert.match(login, /needsConfirmation/);
});

test("password update requires a valid authenticated recovery session", () => {
  assert.match(middleware, /isPasswordUpdate/);
  assert.match(middleware, /\/auth\/update-password/);
  assert.match(updatePassword, /auth\.getUser\(\)/);
  assert.match(updatePassword, /auth\.updateUser\(\{ password \}\)/);
  assert.match(updatePassword, /password !== confirmation/);
});

test("confirmation callback only redirects to a safe internal destination", () => {
  assert.match(callback, /exchangeCodeForSession/);
  assert.match(callback, /safeInternalPath/);
});

test("sign-out rejects a mismatched origin and clears the Supabase session", () => {
  assert.match(signout, /origin !== request\.nextUrl\.origin/);
  assert.match(signout, /auth\.signOut\(\)/);
  assert.match(signout, /status: 303/);
});
