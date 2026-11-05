import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20261105050000_aivanta_google_readonly_products.sql", import.meta.url), "utf8");

test("Google connection product constraint permits only the eight approved read-only products", () => {
  for (const product of ["gmail", "sheets", "drive", "calendar", "docs", "forms", "youtube", "contacts"]) {
    assert.match(migration, new RegExp("'" + product + "'"));
  }
  assert.match(migration, /check \(product in \('gmail', 'sheets', 'drive', 'calendar', 'docs', 'forms', 'youtube', 'contacts'\)\)/);
  assert.doesNotMatch(migration, /gmail\.send|spreadsheets$/);
});
