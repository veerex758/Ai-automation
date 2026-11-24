import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../lib/supabase/permissions.ts", import.meta.url), "utf8");

test("workspace permission resolver grants defaults only to the explicit member role", () => {
  const guard = source.indexOf('if (role !== "member")');
  const customRole = source.indexOf("if (member?.custom_role_id)");
  const defaults = source.indexOf("return { role, customRoleId: null, permissions: DEFAULT_MEMBER_PERMISSIONS };");

  assert.ok(guard >= 0, "unknown and null role values need an explicit denial guard");
  assert.ok(customRole > guard, "the role guard must run before custom-role permission lookup");
  assert.ok(defaults > guard, "the role guard must run before default member permissions");
  assert.match(
    source.slice(guard, customRole),
    /return\s*\{\s*role,\s*customRoleId:\s*null,\s*permissions:\s*\{\}\s*\};/,
    "unexpected roles must receive an empty permission map",
  );
});

test("owner privileges are derived from workspaces.owner_id, not a stale membership role", () => {
  assert.ok(source.includes('const role = workspace.owner_id === userId ? "owner" : member?.role === "owner" ? null : member?.role ?? null;'));
});
