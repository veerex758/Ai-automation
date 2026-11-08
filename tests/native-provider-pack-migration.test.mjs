import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20261105020000_aivanta_native_provider_pack.sql", import.meta.url), "utf8");
test("native provider pack providers are admitted by the workspace credential RPC", () => {
  for (const provider of ["claude","mistral","groq","perplexity","discord","telegram","whatsapp_business","sendgrid","mailgun","postmark","github","gitlab","sentry","vercel","calendly","zendesk","freshdesk","serpapi","openweather"]) {
    assert.match(migration, new RegExp("'" + provider + "'"));
  }
});
test("provider credential writes retain workspace admin and service-role boundaries", () => {
  assert.match(migration, /wm\.role in \('owner','admin'\)/);
  assert.match(migration, /revoke all on function public\.save_workspace_integration_credentials[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.save_workspace_integration_credentials[\s\S]*to service_role/i);
});
