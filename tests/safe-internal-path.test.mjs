import test from "node:test";
import assert from "node:assert/strict";
import { getSafeInternalPath } from "../lib/supabase/safe-internal-path.mjs";

const origin = "https://aivanta-preview.example";

test("safe redirect defaults to dashboard when no target is supplied", () => {
  assert.equal(getSafeInternalPath(null, origin), "/dashboard");
  assert.equal(getSafeInternalPath("", origin), "/dashboard");
});

test("safe redirect preserves same-origin path, query, and fragment", () => {
  assert.equal(
    getSafeInternalPath("/dashboard/workflows?filter=draft#recent", origin),
    "/dashboard/workflows?filter=draft#recent",
  );
});

test("safe redirect rejects protocol-relative and external URLs", () => {
  assert.equal(getSafeInternalPath("//attacker.example/path", origin), "/dashboard");
  assert.equal(getSafeInternalPath("https://attacker.example/path", origin), "/dashboard");
  assert.equal(getSafeInternalPath("javascript:alert(1)", origin), "/dashboard");
});

test("safe redirect rejects backslash-based external URL tricks", () => {
  assert.equal(getSafeInternalPath("/\\\\attacker.example/path", origin), "/dashboard");
});
