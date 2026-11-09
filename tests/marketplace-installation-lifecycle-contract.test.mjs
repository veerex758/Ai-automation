import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile("supabase/migrations/20261109120000_aivanta_marketplace_installation_lifecycle.sql", "utf8");
assert.ok(sql.includes("'installation_'||p_action"));
console.log("Marketplace installation lifecycle contract passed.");
