import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const catalogSource = readFileSync("nodes/provider-catalog.ts", "utf8");
const directorySource = readFileSync("app/dashboard/registry-integrations-directory.tsx", "utf8");
const credentialsSource = readFileSync("lib/integrations/workspace-credentials.ts", "utf8");
const connectionsSource = readFileSync("app/dashboard/connections/page.tsx", "utf8");
const connectionTestSource = readFileSync("app/api/integrations/workspace/test/route.ts", "utf8");
const workerSource = readFileSync("lib/workflows/durable-worker.ts", "utf8");
const resendTestSource = readFileSync("app/api/integrations/workspace/resend/test/route.ts", "utf8");
const saveRouteSource = readFileSync("app/api/integrations/workspace/route.ts", "utf8");

test("all 100 directory entries have official brand artwork or an explicit native icon path", () => {
  const ids = [...catalogSource.matchAll(/"id": "([^"]+)"/g)].map((match) => match[1]);
  const assetsBlock = directorySource.match(/const officialBrandAssets:[\s\S]*?= (\{[\s\S]*?\});\nconst googleProductForNode/);
  assert.ok(assetsBlock, "official brand asset map must remain machine-readable");
  const assets = JSON.parse(assetsBlock[1]);
  const native = new Set([
    "webhook_trigger", "schedule_cron", "manual_trigger", "http_request", "if", "switch", "loop",
    "merge", "wait_delay", "code_js", "set_fields", "json_parse", "filter", "aggregate", "date_ti¶»§q«^